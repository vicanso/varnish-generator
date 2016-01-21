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
backend timtam1{
  .host = "127.0.0.1";
  .port = "3010";
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
backend albi0{
  .host = "127.0.0.1";
  .port = "3020";
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
backend albi1{
  .host = "127.0.0.1";
  .port = "3030";
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

#######################################################################
# Client side


sub vcl_recv {
	/* We do not support SPDY or HTTP/2.0 */
	if (req.method == "PRI") {
		return (synth(405));
	}

  /* set x-forwarded-for */
  if(req.restarts == 0){
    if(req.http.x-forwarded-for){
      set req.http.x-forwarded-for = req.http.x-forwarded-for + ", " + client.ip;
    }else{
      set req.http.x-forwarded-for = client.ip;
    }
    if(req.http.via){
      set req.http.via = req.http.via + ",varnish-test";
    }else{
      set req.http.via = "varnish-test";
    }
  }


  /* backend selctor */
  if(req.http.host == "black" && req.url ~ "/timtam"){
    set req.backend_hint = timtam.backend();
  }elsif(req.http.host == "white" && req.url ~ "/albi"){
    set req.backend_hint = albi.backend();
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
  set req.http.Surrogate-Capability = "key=ESI/1.0";

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
  	# TODY 3s should be use Cache-Control: m-stale
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
  set resp.http.X-hits = obj.hits;

  return (deliver);
}


#######################################################################
# Backend Fetch

sub vcl_backend_fetch {
  return (fetch);
}



sub vcl_backend_response {
  # 该数据在失效之后，保存多长时间才被删除（用于在服务器down了之后，还可以提供数据给用户）
  set beresp.grace = 30m;
  # 若返回的内容是文本类，则压缩该数据（根据response header的content-type判断）
  if(beresp.http.content-type ~ "text" || beresp.http.content-type ~ "application/javascript" || beresp.http.content-type ~ "application/json"){
    set beresp.do_gzip = true;
  }

  # 如果返回的数据ttl为0，设置为不可缓存
  # 对于Set-Cookie的响应设置为不可缓存
  if (beresp.ttl <= 0s ||
    beresp.http.Set-Cookie ||
    beresp.http.Surrogate-control ~ "no-store" ||
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
  return (deliver);
}


#############
# Housekeeping

# init start
sub vcl_init{
  new timtam = directors.random();
  timtam.add_backend(timtam0, 1)
  timtam.add_backend(timtam1, 1)
  new albi = directors.random();
  albi.add_backend(albi0, 1)
  albi.add_backend(albi1, 1)
}
# init end

sub vcl_fini {
  return (ok);
}


