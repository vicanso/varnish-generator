# 1.3.0
  * Supoort custom hash setting
  * Use `yaml.safeLoad` insteadof `yaml.load`

# 1.2.0
  * Improve the function to create `Server-Timing`
  * Support custom pass url setting
  * Support custom TTL for `hit-for-pass`
  * Change the default pass query (cache=false -> cache-control=no-cache)

# 1.1.0
  * Fix the hashKey config invalid
  * The config file support `yaml`
  * Use `Server-Timing` instead of `X-Varnish-Use`
