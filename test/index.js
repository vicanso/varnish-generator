'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const varnishGenerator = require('..');
const backends = require('../backends');
const instance = 'varnish-test';
const request = require('superagent');
var varnishdInstance = null;
// require('./support/server');


function get(url) {
	return request.get(`http://localhost:8080${url}`);
}

function post(url) {
	return request.post(`http://localhost:8080${url}`);
}

const backendConfig =
	'backend albi0{\n  .host = "127.0.0.1";\n  .port = "3020";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend albi1{\n  .host = "127.0.0.1";\n  .port = "3030";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend timtam0{\n  .host = "127.0.0.1";\n  .port = "3000";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}\nbackend timtam1{\n  .host = "127.0.0.1";\n  .port = "3010";\n  .connect_timeout = 3s;\n  .first_byte_timeout = 10s;\n  .between_bytes_timeout = 2s;\n  .probe = {\n    .url = "/ping";\n    .interval = 3s;\n    .timeout = 5s;\n    .window = 5;\n    .threshold = 3;\n  }\n}';
const initConfig =
	'sub vcl_init{\n  new albi = directors.random();\n  albi.add_backend(albi0, 1);\n  albi.add_backend(albi1, 1);\n  new timtam = directors.random();\n  timtam.add_backend(timtam0, 1);\n  timtam.add_backend(timtam1, 1);\n}';
const selectConfig =
	'  if(req.http.host == "white" && req.url ~ "/albi"){\n    set req.backend_hint = albi.backend();\n  }elsif(req.url ~ "/timtam"){\n    set req.backend_hint = timtam.backend();\n  }';


describe('varnish-generator', () => {
	it('should get backend config success', done => {
		varnishGenerator.getBackendConfig(backends).then(result => {
			assert.equal(result, backendConfig);
			done();
		}).catch(done);
	});

	it('should get init config success', done => {
		varnishGenerator.getInitConfig(backends).then(result => {
			assert.equal(result, initConfig);
			done();
		}).catch(done);
	});


	it('should get backend select config success', () => {
		const result = varnishGenerator.getBackendSelectConfig(backends);
		assert.equal(selectConfig, result);
	});


	it('should get varnish config success', done => {
		varnishGenerator.getConfig(backends).then(result => {
			assert.equal(result.backendConfig, backendConfig);
			assert.equal(result.initConfig, initConfig);
			assert.equal(result.selectConfig, selectConfig);
			done();
		}).catch(done);
	});


	it('should get vcl file success', done => {
		varnishGenerator.getConfig(backends).then(config => {
			config.name = instance;
			config.version = (new Date()).toISOString();
			return varnishGenerator.getVcl(config);
		}).then(vcl => {
			fs.writeFile(path.join(__dirname, '../default.vcl'), vcl, done);
		}).catch(done);
	});

	it('should run varnishd success', function(done) {
		this.timeout(10 * 1000);
		const vcl = path.join(__dirname, '../default.vcl');
		const spawn = require('child_process').spawn;
		const args = [
			'-f',
			vcl,
			'-s',
			'malloc,128m',
			'-a',
			'0.0.0.0:8080',
			'-F'
		];
		varnishdInstance = spawn('/usr/local/sbin/varnishd', args);
		varnishdInstance.stdout.on('data', (data) => {
			console.info(`stdout:${data}`);
		});
		varnishdInstance.stderr.on('data', (data) => {
			console.error(`stderr:${data}`);
		});
		setTimeout(done, 5000);
	});

	it('should ping varnish success', done => {
		get('/ping')
			.end((err, res) => {
				if (err) {
					done(err);
				} else {
					assert.equal(res.text, 'pong');
					done();
				}
			});
	});

	it('should get varnish config version success', done => {
		get('/vesrion')
			.end((err, res) => {
				if (err) {
					done(err);
				} else {
					assert(res.text);
					done();
				}
			});
	});

	it('should ping backend success', done => {
		get('/timtam/ping')
			.end((err, res) => {
				if (err) {
					done(err);
				} else {
					assert.equal(res.text, 'pong');
					done();
				}
			});
	});

	// varnish add headers
	it('should add headers success', done => {
		get('/timtam/headers')
			.end((err, res) => {
				if (err) {
					done(err);
				} else {
					const data = res.body;
					assert.equal(data.via, 'varnish-test');
					assert.equal(data['x-forwarded-for'], '127.0.0.1, 127.0.0.1');
					done();
				}
			});
	});

	// not ge and head method will be pass
	it('should pass post request success', done => {
		function check(times) {
			post('/timtam/method')
				.send({
					a: 'b'
				})
				.end((err, res) => {
					if (err) {
						return done(err);
					}
					assert.equal(res.get('X-Hits'), 0);
					assert.equal(res.get('age'), 0);
					if (times) {
						check(--times);
					} else {
						done();
					}
				});
		}
		check(2);
	});

	// querystring include cache=false 
	// or request headers include Cache-Control:no-cache
	it('should pass ?cache=false or &cache=false success', done => {
		function check(times) {
			const url = ['/timtam/cacheable', '/timtam/cacheable',
				'/timtam/cacheable?cache=false', '/timtam/cacheable?id=1&cache=false'
			][times];
			if (!url) {
				return done();
			}
			const req = get(url);
			if (times === 1) {
				req.set('Cache-Control', 'no-cache');
			}
			req.end((err, res) => {
				if (err) {
					return done(err);
				}
				assert.equal(res.get('X-Hits'), 0);
				assert.equal(res.get('age'), 0);
				check(++times);
			});
		}
		check(0);
	});

	// get cacheable url will from cache
	it('should get cacheable data success', done => {
		const start = Date.now();

		function check(times) {
			if (times === 3) {
				return done();
			}
			get('/timtam/cacheable')
				.end((err, res) => {
					if (err) {
						return done(err);
					}
					const pass = Date.now() - start;
					// previous check has created cache
					assert.equal(res.get('X-Hits'), times + 1);
					assert.equal(res.get('age'), parseInt(pass / 1000));
					check(++times);
				});
		}

		check(0);
	});

	// data will be gzip
	it('should gzip data success', done => {
		get('/timtam/gzip')
			.end((err, res) => {
				if (err) {
					return done(err);
				}
				assert.equal(res.get('Content-Encoding'), 'gzip');
				done();
			});
	});

	// hit for pass
	it('should not cache response Cache-Control:max-age=0 success', function(
		done) {
		this.timeout(5000);

		function check(times) {
			const start = Date.now();
			get('/timtam/max-age/0')
				.end((err, res) => {
					if (err) {
						return done(err);
					}
					assert.equal(res.get('X-Hits'), 0);
					const use = Date.now() - start;
					if (times === 1) {
						assert(use > 2000 && use < 3000);
						check(2);
					} else {
						assert(use > 1000 && use < 2000);
					}
					if (times === 2) {
						done();
					}

				});
		}
		check(0);

		setTimeout(function() {
			check(1);
		}, 10);
	});

	// hit for pass
	it('should not cache response Cache-Control:no-store success', function(done) {
		this.timeout(5000);

		function check(times) {
			const start = Date.now();
			get('/timtam/cache-control/no-store')
				.end((err, res) => {
					if (err) {
						return done(err);
					}
					assert.equal(res.get('X-Hits'), 0);
					const use = Date.now() - start;
					if (times === 1) {
						assert(use > 2000 && use < 3000);
						check(2);
					} else {
						assert(use > 1000 && use < 2000);
					}
					if (times === 2) {
						done();
					}

				});
		}
		check(0);

		setTimeout(function() {
			check(1);
		}, 10);
	});


	// hit for pass when set-cookie
	it('should not cache response set-cookie success', function(done) {
		this.timeout(5000);

		function check(times) {
			const start = Date.now();
			get('/timtam/set-cookie')
				.end((err, res) => {
					if (err) {
						return done(err);
					}
					assert.equal(res.get('X-Hits'), 0);
					const use = Date.now() - start;
					if (times === 1) {
						assert(use > 2000 && use < 3000);
						check(2);
					} else {
						assert(use > 1000 && use < 2000);
					}
					if (times === 2) {
						done();
					}

				});
		}
		check(0);

		setTimeout(function() {
			check(1);
		}, 10);
	});


	// will responese stale while in stale time
	it('should response from cache while in stale time', function(done) {
		this.timeout(10000);
		let data = null;
		function check(times) {
			get('/timtam/max-age/1')
				.end((err, res) => {
					if (err) {
						return done(err);
					}
					if (times === 0) {
						data = res.body;
					} else if(times === 1){
						assert.equal(data.date, res.body.date);
						assert.equal(res.get('age'), 2);
					} else {
						assert.notEqual(data.date, res.body.date);
						assert.equal(res.get('age'), 1);
						done();
					}
					setTimeout(function(){
						check(++times);
					}, 2200);	
				});
		}
		check(0);
	});

	// backend is healthy, stale time

	// backend is not healthy

	// parallel request

	it('should close varnishd success', done => {
		varnishdInstance.kill();
		done();
	});
});