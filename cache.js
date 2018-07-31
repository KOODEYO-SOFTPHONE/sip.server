'use strict';

let Caching = require('caching');

// .set('key',ttl/*ms*/,'value') //ttl - время жизни в mc
// .get('key', calback)          //calback(err,result)
// .remove('key') 

function Cache() {
    let caching = Caching.apply(this, arguments);

    if (arguments[0] === 'redis') {
        this.get = function(pattern, callback) {
            let self = this;
            let work = function(key, callback) {
                self.client.get(key, function(err, result) {
                    try {
                        result = JSON.parse(result);
                    } catch (e) {
                        console.log('JSON.parse', e);
                    }
                    callback(err, result);
                })
            };
            if (~pattern.indexOf('*')) {
                self.client.keys(pattern, function(err, keys) {
                    if (keys.length) {
                        let total = keys.length;
                        let data = [];

                        function _job(err, res) {
                            if (!err)
                                data.push(res);
                            if (!--total)
                                callback(err, data);
                        };

                        keys.forEach(function(key) {
                            work(key, _job);
                        })
                    } else
                        callback(null, null);
                });
            } else {
                work(pattern, callback);
            }
        };
        this.set = caching.store.set.bind(caching.store);
        this.remove = caching.store.remove.bind(caching.store);
    } else {
        let selfCache = this;

        this.set = function (key, ttl, result) {
            key = key.replace("+","");
            if (this.cache && this.cache[key] && this.cache[key]._timeOut)
                clearTimeout(this.cache[key]._timeOut);

            this.cache[key] = result;

            if (ttl) {
                let self = this;
                this.cache[key]._timeOut = setTimeout(function () {
                    delete self.cache[key];

                    if (selfCache.onChange) {
                        selfCache.onChange();
                    }
                }, ttl);
            }
            if (selfCache.onChange) {
                selfCache.onChange();
            }
        };
        this.set = this.set.bind(caching.store);

        this.get = function(pattern, callback) {
            pattern = pattern.replace("+","");
            let self = this;
            if (~pattern.indexOf('*')) {
                pattern = new RegExp(pattern.replace(/\*/g, '.*'), 'g');
                let data = [];
                let keys = Object.keys(this.cache);
                if (!keys.length)
                    process.nextTick(function() {
                        callback(null, null);
                    });
                else
                    keys.forEach(function(key, i, array) {
                        if (pattern.test(key)) {
                            data.push(self.cache[key]);
                        };
                        pattern.lastIndex = 0;
                        if (array.length == i + 1) {
                            process.nextTick(function() {
                                callback(null, (data.length && data) || null);
                            });
                        }
                    });

            } else {
                process.nextTick(function() {
                    callback(null, self.cache[pattern] || null);
                });
            }
        };
        this.remove = function(pattern) {
            if (~pattern.indexOf('*')) {
                let self = this;
                pattern = new RegExp(pattern.replace(/\*/g, '.*'), 'g');
                Object.keys(this.cache).forEach(function(key) {
                    if (pattern.test(key)) {
                        delete self.cache[key];
                    }
                    pattern.lastIndex = 0;
                });
            } else {
                delete this.cache[pattern];
            }
        };
        this.remove = this.remove.bind(caching.store);
    }
    this.get = this.get.bind(caching.store);
};

module.exports = Cache;