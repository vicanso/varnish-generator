package main

import (
	"flag"
	"github.com/tj/go-debug"
	"github.com/vicanso/varnish-generator/generator"
)

var configFile = flag.String("config", "./config.yml", "The config file of vanish")
var targetFile = flag.String("target", "./default.vcl", "The varnish vcl file")
var dbg = debug.Debug("varnish-generator")

func main() {
	flag.Parse()
	dbg("configFile:%s", *configFile)
	dbg("targetFile:%s", *targetFile)
	generator.GetVcl(*configFile)
	// conf := getVarnishConfig(*configFile)
	// dbg("conf:%s", conf)
	// getVcl(conf)
}
