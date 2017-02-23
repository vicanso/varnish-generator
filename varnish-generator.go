package main

import (
	"flag"
	"fmt"
	"github.com/tj/go-debug"
	"github.com/vicanso/varnish-generator/generator"
	"io/ioutil"
)

var configFile = flag.String("config", "./config.yml", "The config file of vanish")
var targetFile = flag.String("target", "./default.vcl", "The varnish vcl file")
var dbg = debug.Debug("varnish-generator")

func main() {
	flag.Parse()
	dbg("configFile:%s", *configFile)
	dbg("targetFile:%s", *targetFile)
	vcl := generator.GetVcl(*configFile)
	err := ioutil.WriteFile(*targetFile, []byte(vcl), 0644)
	if err != nil {
		panic(err)
	}
	fmt.Println("Create varnish vcl success. The file is", *targetFile)
}
