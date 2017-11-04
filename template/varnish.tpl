# varnish version <%= varnish %>
vcl 4.0;
import std;
import directors;

# backend start
<%= backendConfig %>
# backend end


#############
# Housekeeping

# init start
<%= initConfig %>
# init end

sub vcl_fini {
  return (ok);
}

#######################################################################
# Client side


sub vcl_recv {
  call custom_ctrl;

  /* We do not support SPDY or HTTP/2.0 */
  if (req.method == "PRI") {
    return (synth(405));
  }
  if (req.restarts == 0) {
    /* set X-Forwarded-For */
    if (req.http.X-Forwarded-For) {
      set req.http.X-Forwarded-For = req.http.X-Forwarded-For + ", " + client.ip;
    } else {
      set req.http.X-Forwarded-For = client.ip;
    }
    /* set Via */
    if (req.http.Via) {
      set req.http.Via = req.http.Via + ", <%= name %>";
    } else {
      set req.http.Via = "<%= name %>";
    }
    set req.http.startedAt = std.time2real(now, 0.0);
  }



  /* backend selector */
<%= selectConfig %>

  if (req.method != "GET" &&
    req.method != "HEAD" &&
    req.method != "PUT" &&
    req.method != "POST" &&
    req.method != "TRACE" &&
    req.method != "OPTIONS" &&
    req.method != "DELETE") {
      /* Non-RFC2616 or CONNECT which is weird. */
      return (pipe);
  }

  /* Implementing websocket support (https://www.varnish-cache.org/docs/4.0/users-guide/vcl-example-websockets.html) */
  if (req.http.Upgrade ~ "(?i)websocket") {
    return (pipe);
  }


  if (req.method != "GET" && req.method != "HEAD") {
    /* We only deal with GET and HEAD by default */
    return (pass);
  }

  /* Not cacheable */
  if (req.http.Authorization) {
    return (pass);
  }

  # no cache request
  if (<%= passRules %>) {
    return (pass);
  }

  # Send Surrogate-Capability headers to announce ESI support to backend
  # set req.http.Surrogate-Capability = "key=ESI/1.0";

  # sort the query string
  set req.url = std.querysort(req.url);

  return (hash);
}


sub vcl_pipe {
  # By default Connection: close is set on all piped requests, to stop
  # connection reuse from sending future requests directly to the
  # (potentially) wrong backend. If you do want this to happen, you can undo
  # it here.
  # unset bereq.http.connection;
  if (req.http.upgrade) {
    set bereq.http.upgrade = req.http.upgrade;
  }
  return (pipe);
}


sub vcl_pass {
  return (fetch);
}


sub vcl_hash {
<%= hashConfig %>
  return (lookup);
}


sub vcl_purge {
  return (synth(200, "Purged"));
}


sub vcl_hit {
  if (obj.ttl > 0s) {
    # A pure unadultered hit, deliver it
    return (deliver);
  }
  # backend is healthy
  if (std.healthy(req.backend_hint)) {
    # set the stale
    if(obj.ttl + std.duration(std.integer(regsub(obj.http.Cache-Control, "[\s\S]*m-stale=(\d)+[\s\S]*", "\1"), <%= stale %>) + "s", <%= stale %>s) > 0s){
      return (deliver);
    }
  } else if (obj.ttl + obj.grace > 0s) {
    # Object is in grace, deliver it
    # Automatically triggers a background fetch
    return (deliver);
  }

  # fetch & deliver once we get the result
  return (miss);
}


sub vcl_miss {
  return (fetch);
}


sub vcl_deliver {
  # Happens when we have all the pieces we need, and are about to send the
  # response to the client.
  #
  # You can do accounting or modifying the final object here.
  set resp.http.X-Hits = obj.hits;
  set req.http.varnishUse = std.real(1000, 0.0) * std.real((now - std.real2time(std.real(req.http.startedAt, 0.0), now)), 0);
  if (resp.http.Server-Timing) {
    if (std.real(req.http.varnishUse, 0) > 0) {
      set resp.http.Server-Timing = "9=" + req.http.varnishUse + {";"Varnish","} + resp.http.Server-Timing;
    } else {
      set resp.http.Server-Timing = {"9=0.000;"Varnish","} + resp.http.Server-Timing;
    }
  } else {
    if (std.real(req.http.varnishUse, 0) > 0) {
      set resp.http.Server-Timing = "9=" + req.http.varnishUse + {";"Varnish""};
    } else {
      set resp.http.Server-Timing = {"9=0.000;"Varnish""};
    }
  }
  return (deliver);
}



# custom control
sub custom_ctrl{
  #响应healthy检测
  if(req.url == "/ping"){
    return(synth(701));
  }
  if(req.url == "/varnish/version") {
    return(synth(702));
  }
}


sub vcl_synth {
  if (resp.status == 701) {
    synthetic("pong");
  } elsif (resp.status == 702) {
    synthetic("<%= version %>");
  }
  set resp.http.Cache-Control = "no-store, no-cache, must-revalidate, max-age=0";
  set resp.status = 200;
  set resp.http.Content-Type = "text/plain; charset=utf-8";
  return (deliver);
}


#######################################################################
# Backend Fetch

sub vcl_backend_fetch {
  <% if (varnish >= '5') { %>
  if (bereq.method == "GET") {
    unset bereq.body;
  }
  <% } %>
  return (fetch);
}



sub vcl_backend_response {
  # the response body is text, do gzip (judge by response header Content-Type)
  if (beresp.http.Content-Type ~ "text" || beresp.http.Content-Type ~ "application/javascript" || beresp.http.Content-Type ~ "application/x-javascript" || beresp.http.Content-Type ~ "application/json") {
    set beresp.do_gzip = true;
  }
  if (bereq.uncacheable) {
    return (deliver);
  }
  # The following scenarios set uncacheable
  if (beresp.ttl <= 0s ||
    beresp.http.Set-Cookie ||
    beresp.http.Surrogate-Control ~ "no-store" ||
    (!beresp.http.Surrogate-Control &&
      beresp.http.Cache-Control ~ "no-cache|no-store|private") ||
    beresp.http.Vary == "*"){
    # Hit-For-Pass
    set beresp.uncacheable = true;
    set beresp.ttl = <%= hisForPassTTL %>s;
    set beresp.grace = 0s;
    return (deliver);
  }

  # Pause ESI request and remove Surrogate-Control header
  if (beresp.http.Surrogate-Control ~ "ESI/1.0") {
    unset beresp.http.Surrogate-Control;
    set beresp.do_esi = true;
  }

  return (deliver);
}
