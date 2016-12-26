/**
 * @module util
 */

/**
 * @class Util
 * @constructor
 */

/**
 * Возвращает содержимое каталога
 * @method getFiles
 * @param {String} dir путь к каталогу
 * @param {Boolean} fileOnly false - включая каталоги и файлы, true - только файлы
 * @param {String} mask маска поиска
 * @return {Array} список содиржимого каталога
 */
exports.getFiles = function (dir, fileOnly, mask) {
    if (fileOnly == undefined) fileOnly = true;
    if (mask == undefined) mask = '';
    mask = new RegExp(mask);
    if (dir && dir[dir.length - 1] !== '/')
        dir += '/';
    var fs = require('fs'),
        files = [];
    try {
        var f = fs.readdirSync(dir), isFile, isHiddden;
        for (var i in f) {
            isFile = fs.statSync(dir + f[i]).isFile();
            isHidden = /^\./.test(f[i]);
            if (!isHidden)
                if (!fileOnly || isFile)
                    if (!isFile || (isFile && mask.test(f[i])))
                        files.push(f[i]);
        }
    } catch (err) {
        console.log(err);
    }
    return files;
};

/**
 * формирует дату в формате 'день.месяц.год часы:минуты:секунды'
 * @method formatDate
 *
 * @param {Date} date - дата, полученная при обращении к конструктору new Date()
 * @return {String} strData - возвращаемая строка с датой
 */
function formatDate(date) {
    var dd = date.getDate()
    if (dd < 10) dd = '0' + dd;

    var mm = date.getMonth() + 1
    if (mm < 10) mm = '0' + mm;

    var yy = date.getFullYear();

    var hh = date.getHours();
    if (hh < 10) hh = '0' + hh;

    var min = date.getMinutes();
    if (min < 10) min = '0' + min;

    var sec = date.getSeconds();
    if (sec < 10) sec = '0' + sec;

    var strData = dd + '.' + mm + '.' + yy + ' ' + hh + ':' + min + ':' + sec + '';

    return strData;
};

/**
 * Создает объект с методами логгирования
 * @method getLogObj
 * @param {String} name Имя объекта
 * @param {EventEmitter} app Объект events.EventEmitter
 * @return {Object} Возвращает объект со свойством name и методами trace,debug,info,warn,error,fatal
 */
exports.getLogObj = function (name, app) {
    if (!(app instanceof require('events').EventEmitter))
        return null;
    function log(level, owner, message, category) {
        var logObj = {
            level: level,
            owner: owner,
            message: message
        };
        if (category)
            logObj.category = category;
        if (app._loggerReady)
            app.emit('sys.message', logObj);
        else
            app._logCash && app._logCash.push(logObj);
    };
    return {
        name: name,
        trace: function (msg, category) {
            log('trace', this.name, msg, category);
        },
        debug: function (msg, category) {
            log('debug', this.name, msg, category);
        },
        info: function (msg, category) {
            log('info', this.name, msg, category);
        },
        warn: function (msg, category) {
            log('warn', this.name, msg, category);
        },
        error: function (msg, category) {
            log('error', this.name, msg, category);
        },
        fatal: function (msg, category) {
            log('fatal', this.name, msg, category);
        }
    }
}

module.exports.formatDate = formatDate;
