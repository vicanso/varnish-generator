'use strict';
const assert = require('assert');
const varnishGenerator = require('..');
const varnishConfig = require('../examples/config.json');
const directors = varnishConfig.directors;
const backends = varnishConfig.backends;
const fs = require('fs');
const path = require('path');

const backendConfig =
  'backend dcharts0 {\n  .host = "127.0.0.1";\n  .port = "3020";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend dcharts1 {\n  .host = "127.0.0.1";\n  .port = "3030";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend vicanso0 {\n  .host = "127.0.0.1";\n  .port = "3040";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend vicanso1 {\n  .host = "127.0.0.1";\n  .port = "3050";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend timtam0 {\n  .host = "127.0.0.1";\n  .port = "3000";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend timtam1 {\n  .host = "127.0.0.1";\n  .port = "3010";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend aslant0 {\n  .host = "127.0.0.1";\n  .port = "8000";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}';
const initConfig =
  'sub vcl_init {\n  new dcharts = directors.hash();\n  dcharts.add_backend(dcharts0, 5);\n  dcharts.add_backend(dcharts1, 3);\n  new vicanso = directors.random();\n  vicanso.add_backend(vicanso0, 10);\n  vicanso.add_backend(vicanso1, 5);\n  new timtam = directors.fallback();\n  timtam.add_backend(timtam0);\n  timtam.add_backend(timtam1);\n  new aslant = directors.round_robin();\n  aslant.add_backend(aslant0);\n}';
const selectConfig =
  '  set req.backend_hint = aslant.backend();\n  if (req.http.host == "dcharts.com" && req.url ~ "^/dcharts") {\n    set req.backend_hint = dcharts.backend(req.url);\n  } elsif (req.http.host == "vicanso.com") {\n    set req.backend_hint = vicanso.backend();\n  } elsif (req.url ~ "^/timtam") {\n    set req.backend_hint = timtam.backend();\n  }';


describe('varnish-config', () => {
  it('should get backend config success', done => {
    varnishGenerator.getBackendConfig(directors).then(result => {
      assert.equal(result, backendConfig);
      done();
    }).catch(done);
  });
  

  it('should get init config success', done => {
    varnishGenerator.getInitConfig(directors).then(result => {
      assert.equal(result, initConfig);
      done();
    }).catch(done);
  });



  it('should get backend select config success', () => {
    const result = varnishGenerator.getBackendSelectConfig(directors);
    assert.equal(selectConfig, result);
  });


  it('should get varnish config success', done => {
    varnishGenerator.getConfig(directors).then(result => {
      assert.equal(result.backendConfig, backendConfig);
      assert.equal(result.initConfig, initConfig);
      assert.equal(result.selectConfig, selectConfig);
      done();
    }).catch(done);
  });

  it('should get vcl file success', done => {
    varnishGenerator.getVcl(varnishConfig).then(vcl => {
      assert(vcl);
      done();
    }).catch(done);
  });


});