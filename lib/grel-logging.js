"use strict";
let formatDate = require("date-fns/format");
if (formatDate && typeof(formatDate) !== "function") 
    formatDate = formatDate.formatDate;
const stringifySafe = require('json-stringify-safe');
const fs = require("fs");
const path = require("path")
const util = require("util");
const _ = require("lodash");;

const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf } = format;

const projectId = process.env['GOOGLE_PROJECT_ID'];
let {LoggingWinston} = require('@google-cloud/logging-winston');
const keyFilename = path.resolve("./.private/Membrit-node-1.json");
const _transports = [ new transports.Console(), ]
let winstonGoogle;
globalThis.isDevServer = process.env.LOCAL_DEV;

const cloudLogging = false; //process.env.CLOUD_LOGGING;

// if we have the cert, we can add cloud logging
try {
    let keyContents = fs.readFileSync(keyFilename);
    if (keyContents && cloudLogging) {
        console.log("[LOGGING] cloud-logging: ACTIVE")
        winstonGoogle = new LoggingWinston({  projectId,  keyFilename, });
        _transports.push(winstonGoogle);     
    }
} catch (err) {
//     console.log("[LOGGING] cloud-logging.catch: off")
}

// Create a Winston logger that streams to Stackdriver Logging
// Logs will be written to: "projects/YOUR_PROJECT_ID/logs/winston_log"
let winstonLogger;

const myFormat = printf(({ level, message, label, timestamp }) => {
    let dt = formatDate(new Date(timestamp),"MM-dd HH:mm:ss")
    return `${dt} ${label ? `[${label}] `: ""}${level}: ${message}`;
});
winstonLogger = createLogger({
  level: 'info', // only errors, warnings & info will be logged
  format: cloudLogging ? combine(format.json(),myFormat) : combine(timestamp(),format.json(),myFormat),
  transports: _transports
});


let settings, appCode = "ad-hoc", useConsole = process.env.LOCAL_DEV;

const setOptions = (options = {}) => {
    let { timestamps, name, console: _console } = options;
    if (timestamps !== undefined) {
        global.includeTimestamp = !!timestamps;
    }
    if (name !== undefined) {
        appCode = name.toUpperCase();
    }
    if (isDevServer) {
        useConsole = true;
    } else if (_console !== undefined) {
        useConsole = _console;
    }
    setLogFunctions();
}
const init = (config = {}) => {
    if (!settings) {
        settings = _.extend({},config);
    }
    return settings;
}
let display, logError, logWarning, logInfo,logDebug;

const stamp = () => {
    let dt = new Date();
    let str = formatDate(dt,"HH:mm:ss.S");
    return str;
}
const logArgs = (...args) => {
    let logArgs = args;
    try {
        logArgs = args.reduce((arr,arg) => {
            if (typeof(arg) === "object") {
                try {
                    let json = JSON.stringify(arg);
                    arg = json.replace(/\\"/g,"`");
                } catch (err) {}
            }
            arr.push(arg);
            return arr;
        },[])
    } catch (err) {
        console.error(`[IAP] logArgs.catch`,err);
    }
    return logArgs || [];
}

const setLogFunctions = () => {
    display = (...args) =>      { return (winstonLogger && !useConsole) ? winstonLogger.info(...logArgs(args)) : console.log(stamp(),...args); }
    logError = (...args) =>     { return (winstonLogger && !useConsole) ? winstonLogger.error(...logArgs(args)) : console.error(stamp(),...args) }
    logWarning = (...args) =>   { return (winstonLogger && !useConsole) ? winstonLogger.warn(...logArgs(args)) : console.warn(stamp(),...args); }
    logInfo = (...args) =>      { return (winstonLogger && !useConsole) ? winstonLogger.info(...logArgs(args)) : console.log(stamp(),...args); }
    logDebug = (...args) =>     { return (winstonLogger && !useConsole) ? winstonLogger.debug(...logArgs(args)) : console.debug(stamp(),...args);; }
}
setLogFunctions();

if (process.env.LOCAL_DEV) {
    global.includeTimestamp = true;
}

module.exports = {
    init,
    display,
    debug: logDebug,
    info: logInfo,
    log: logInfo,
    warn: logWarning,
    error: logError,
    set: setOptions,
    settings: () => { return init(); },
};