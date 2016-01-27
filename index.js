'use strict';
const _ = require('lodash');
const path = require('path');
const fs = require('fs');

exports.getBackendConfig = getBackendConfig;
exports.getInitConfig = getInitConfig;
exports.getBackendSelectConfig = getBackendSelectConfig;
exports.getConfig = getConfig;
exports.getVcl = getVcl;

/**
 * [sortServer description]
 * @param  {[type]} serverList [description]
 * @return {[type]}            [description]
 */
function sortServer(serverList) {
	let result = {};
	_.forEach(serverList, function(server) {
		let name = server.name;
		if (!result[name]) {
			result[name] = [];
		}
		result[name].push(server);
	});
	// 将有配置host的排在前面
	result = _.values(result);
	result.sort(function(tmp1, tmp2) {
		let host1 = tmp1[0].host;
		let host2 = tmp2[0].host;
		let name1 = tmp1[0].name;
		let name2 = tmp2[0].name;
		if (host1 && !host2) {
			return -1;
		} else if (!host1 && host2) {
			return 1;
		} else if (name1 < name2) {
			return 1;
		} else if (name1 > name2) {
			return -1;
		} else {
			return 0;
		}
	});
	return result;
}

/**
 * [getBackendConfig description]
 * @param  {[type]} serverList [description]
 * @return {[type]}            [description]
 */
function getBackendConfig(serverList) {
	serverList = sortServer(serverList);
	return readFilePromise(path.join(__dirname,
			'template/backend.tpl'))
		.then(tpl => {
			const template = _.template(tpl);
			const arr = [];
			_.forEach(serverList, (servers) => {
				_.forEach(servers, (server, i) => {
					const tmp = _.pick(server, 'name ip port'.split(' '));
					tmp.name += i;
					try {
						arr.push(template(tmp));
					} catch (err) {
						/* istanbul ignore if */
						console.error(err);
					}
				});
			});
			return arr.join('\n');
		});
}


/**
 * [getInitConfig description]
 * @param  {[type]} serverList [description]
 * @return {[type]}            [description]
 */
function getInitConfig(serverList) {
	serverList = sortServer(serverList);
	return readFilePromise(path.join(__dirname, 'template/init.tpl'))
		.then(tpl => {
			const template = _.template(tpl);
			const arr = [];
			_.forEach(serverList, (servers) => {
				const name = servers[0].name;
				arr.push(`new ${name} = directors.random();`);
				_.forEach(servers, (server, i) => {
					arr.push(`${name}.add_backend(${name + i}, ${server.weight || 1});`);
				});
			});
			_.forEach(arr, (tmp, i) => {
				arr[i] = '  ' + tmp;
			});
			return template({
				directors: arr.join('\n')
			});
		});
}


/**
 * [getBackendSelectConfig description]
 * @param  {[type]} serverList [description]
 * @return {[type]}            [description]
 */
function getBackendSelectConfig(serverList) {
	serverList = sortServer(serverList);
	const result = [];
	_.forEach(serverList, (servers) => {
		const server = servers[0];
		const arr = [];
		if (server.host) {
			arr.push(`req.http.host == "${server.host}"`);
		}
		if (server.prefix) {
			arr.push(`req.url ~ "${server.prefix}"`);
		}
		const condition = arr.join(' && ');
		if (condition) {
			result.push({
				name: server.name,
				condition: condition
			});
		}
	});

	const arr = [];
	_.forEach(result, (item, i) => {
		if (i === 0) {
			arr.push(`if(${item.condition}){`);
		} else {
			arr.push(`}elsif(${item.condition}){`);
		}
		arr.push(`  set req.backend_hint = ${item.name}.backend();`);
	});
	if (arr.length) {
		arr.push('}');
		_.forEach(arr, (tmp, i) => {
			arr[i] = '  ' + tmp;
		});
	}
	return arr.join('\n');
}

/**
 * [getConfig description]
 * @param  {[type]} serverList [description]
 * @return {[type]}            [description]
 */
function getConfig(serverList) {
	const data = {};
	return getBackendConfig(serverList).then(config => {
		data.backendConfig = config;
		return getInitConfig(serverList);
	}).then(config => {
		data.initConfig = config;
		data.selectConfig = getBackendSelectConfig(serverList);
		return data;
	});
}

/**
 * [getVcl description]
 * @param  {[type]} config [description]
 * @return {[type]}        [description]
 */
function getVcl(config){
	if (!config.backends || !config.name || !config.version) {
		throw new Error('backends, name and version can not be null');
	}
	_.extend(config, {
		stale: '3s',
		keep: '10s',
		grace: '30m'
	});
	return getConfig(config.backends).then(data => {
		_.extend(config, data);
		return readFilePromise(path.join(__dirname, 'template/varnish.tpl'));
	}).then(tpl => {
		return _.template(tpl)(config);
	});
}



/**
 * [readFilePromise description]
 * @param  {[type]} file [description]
 * @return {[type]}      [description]
 */
function readFilePromise(file) {
	return new Promise((resolve, reject) => {
		fs.readFile(file, 'utf8', (err, data) => {
			/* istanbul ignore if */
			if (err) {
				reject(err);
			} else {
				resolve(data);
			}
		});
	});
}