vcl 4.0;
import std;
import directors;

# backend start
backend timtam0{
  .host = "127.0.0.1";
  .port = "3000";
  .connect_timeout = 3s;
  .first_byte_timeout = 10s;
  .between_bytes_timeout = 2s;
  .probe = {
    .url = "/ping";
    .interval = 3s;
    .timeout = 5s;
    .window = 5;
    .threshold = 3;
  }
}
# backend end


#############
# Housekeeping

# init start
sub vcl_init{
  new timtam = directors.random();
  timtam.add_backend(timtam0, 1);
}
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
  if(req.restarts == 0){
    /* set X-Forwarded-For */
    if(req.http.X-Forwarded-For){
      set req.http.X-Forwarded-For = req.http.X-Forwarded-For + ", " + client.ip;
    }else{
      set req.http.X-Forwarded-For = client.ip;
    }
    /* set Via */
    if(req.http.Via){
      set req.http.Via = req.http.Via + ", varnish-test";
    }else{
      set req.http.Via = "varnish-test";
    }

    set req.http.X-Varnish-StartedAt = std.time2real(now, 0.0);
  }



  /* backend selector */
  if(req.url ~ "^/timtam"){
    set req.backend_hint = timtam.backend();
  }
  
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
  if(req.http.Authorization){
    return (pass);
  }

  # no cache request
  if(req.url ~ "\?cache=false" || req.url ~ "&cache=false" || req.http.Cache-Control == "no-cache"){
    return (pass);
  }

  # Send Surrogate-Capability headers to announce ESI support to backend
  # set req.http.Surrogate-Capability = "key=ESI/1.0";

  # all requst should be cacheable, so we remove cookie
  unset req.http.Cookie;
  return (hash);
}


sub vcl_pipe {
  if(req.http.upgrade){
    set bereq.http.upgrade = req.http.upgrade;
  }
  return (pipe);
}


sub vcl_pass {
  return (fetch);
}


sub vcl_hash{
  hash_data(req.url);
  if(req.http.host){
    hash_data(req.http.host);
  }else{
    hash_data(server.ip);
  }
  return (lookup);
}


sub vcl_purge {
  return (synth(200, "Purged"));
}


sub vcl_hit {
  if (obj.ttl >= 0s) {
    # A pure unadultered hit, deliver it
    return (deliver);
  }
  # backend is healthy
  if(std.healthy(req.backend_hint)){
    # TODO 3s should be use Cache-Control: m-stale
    if(obj.ttl + 3s > 0s){
      return (deliver);
    }
  }else if(obj.ttl + obj.grace > 0s){
    # Object is in grace, deliver it
    # Automatically triggers a background fetch
    return (deliver);
  }

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
  unset resp.http.Via;
  set resp.http.X-Hits = obj.hits;
  set resp.http.X-Varnish-Times = std.time2real(now, 0.0) + ", " + req.http.X-Varnish-StartedAt;
  return (deliver);
}



# 自定义的一些url的处理
sub custom_ctrl{
  #响应healthy检测
  if(req.url == "/ping"){
    return(synth(701));
  }
  if(req.url == "/varnish/version") {
    return(synth(702));
  }
  if(req.url == "/varnish/updated-time") {
    return(synth(703));
  }
}


sub vcl_synth {
  if(resp.status == 701){
    synthetic("pong");
  } elsif(resp.status == 702){
    synthetic("2016-01-27");
  } elsif(resp.status == 703){
    synthetic("2016-01-27");
  }
  set resp.http.Cache-Control = "no-store, no-cache, must-revalidate, max-age=0";
  set resp.status = 200;
  set resp.http.Content-Type = "text/plain; charset=utf-8";
  return (deliver);
}


#######################################################################
# Backend Fetch

sub vcl_backend_fetch {
  return (fetch);
}



sub vcl_backend_response {
  set beresp.keep = 0s;
  set beresp.grace = 0s;
  # 若返回的内容是文本类，则压缩该数据（根据response header的Content-Type判断）
  if(beresp.http.Content-Type ~ "text" || beresp.http.Content-Type ~ "application/javascript" || beresp.http.Content-Type ~ "application/json"){
    set beresp.do_gzip = true;
  }

  # 如果返回的数据ttl为0，设置为不可缓存
  # 对于Set-Cookie的响应设置为不可缓存
  if (beresp.ttl <= 0s ||
    beresp.http.Set-Cookie ||
    beresp.http.Surrogate-Control ~ "no-store" ||
    (!beresp.http.Surrogate-Control &&
      beresp.http.Cache-Control ~ "no-cache|no-store|private") ||
    beresp.http.Vary == "*"){
    # Hit-For-Pass
    set beresp.uncacheable = true;
    set beresp.ttl = 120s;
    return (deliver);
  }

  # Pause ESI request and remove Surrogate-Control header
  if (beresp.http.Surrogate-Control ~ "ESI/1.0") {
    unset beresp.http.Surrogate-Control;
    set beresp.do_esi = true;
  }

  # 该数据在失效之后，保存多长时间才被删除（用于在服务器down了之后，还可以提供数据给用户）
  set beresp.grace = 30m;
  
  # 缓存在过期之后保留多长时间，主要用于(If-Modified-Since / If-None-Match)
  set beresp.keep = 10s;
  return (deliver);
}



