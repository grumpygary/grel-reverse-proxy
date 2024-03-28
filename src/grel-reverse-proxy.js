/*-----------------------------------------------------------------------
    (c) 2020, Gary Skiba
    (c) 2020, Grinning Elephant

    This is a reverse proxy server that can handle multiple domains.
    See readme.md for instructions on how to set up the proxy-config.js file.
-----------------------------------------------------------------------*/
"use strict";

// node.js native
const fs = require("fs");
const path = require("path");
const httpServer = require('http');
const https = require("https"); // for localhost

// std packages
const express = require('express');
const helmet = require("helmet");
const _ = require("lodash");

// packages required for reverse proxy
const tls = require("tls");
const vhost = require('vhost');
const { createProxyMiddleware } = require('http-proxy-middleware');
const serveStatic = require('serve-static')

// should go outside of this
let configFile;
try {
    configFile = require(`${__dirname}/../proxy-config.js`);
} catch (err) {
    logger.log(`You must provide a "proxy-config.js" file.  You can copy 'sample-config.js' to get started.   See readme.md for details.`)
    process.exit(-1);
}
let logger = require("../lib/grel-logging.js");
let __verbose = configFile.verbose;
const verbose = (...args) => {
    if (__verbose) {
        logger.log(...args);
    }
}
const { response } = require("express");
logger.set({ name: "FILE-SERVER", timestamps: true, console: true });

const rqIpAddress = (rq) => {
    let ip = rq.headers['x-forwarded-for'] || rq.socket.remoteAddress;
    return ip;
}

const allowCrossDomain = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,PATCH,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Device,Authorization,ApiKey,visitor_id');

    res.header('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.header('Cross-Origin-Opener-Policy', 'unsafe-none');

    if (req.method === "OPTIONS") {
        res.header('Content-Type', 'application/octet-stream');
        res.send({});
        res.end();
    } else {
        next();
    }
    // next();
}

const trimMultiLineString = (str0, options = {}) => {
    let str = str0;
    // 2019 - Only trim the beginning
    // in markdown, extra spaces at the end will force a line break.
    if (str !== undefined && typeof (str) == 'string') {
        var lines0 = str.split("\n"),
            lines = [];
        if (lines0.length > 1) {
            let starts = "";
            if (options.markdown !== false) {
                let nLines = 0, li;
                let trimSpaces = 1000;
                lines0.forEach(line => {
                    let leadingSpaces = 0;
                    if (line.trimStart().length) {
                        for (li = 0; line[li] <= " " && li < line.length; li++) {
                            leadingSpaces++;
                        }
                        if (nLines && leadingSpaces < trimSpaces) {
                            trimSpaces = leadingSpaces;
                        }
                    }
                    nLines++; // after the first line we don't care
                }, 1000);
                // trimSpaces should now be the # spaces on ALL lines after the first one
                if (trimSpaces && trimSpaces < 1000) {
                    starts = _.repeat(" ", trimSpaces);
                }
            }
            _.forEach(lines0, (line, index) => {
                let txt = line, trimmed, bol;
                if (starts) {
                    bol = txt.substr(0, starts.length);
                    if (bol == starts) {
                        txt = txt.substr(starts.length);
                    }
                }
                trimmed = txt.trimEnd();
                if (lines.length || trimmed) 
                    lines.push(txt)
            });
            str = lines.join('\n');
        }
    }
    return str;
}
const siteList = ['unsplash.com','google.com','gstatic.com','googleapis.com','storage.googleapis.com','cdn-apple.com','validator.fovea.cc','mux.com','grel.us',];
let sites =  siteList.map(s=>`*.${s}`).join(" ");

let __csp = `default-src 'self';
connect-src * data: blob: filesystem: ${sites};
style-src 'self' data: 'unsafe-inline' *.google.com *.googleapis.com;
img-src 'self' data: ${sites};
frame-src 'self' data: *.google.com *.googleapis.com;
font-src 'self' data:;
script-src 'self' 'unsafe-inline' data: *.google.com *.googleapis.com ${sites};
media-src * data: blob: filesystem: ${sites};
`
// __csp = trimMultiLineString(__csp);
__csp = __csp.replace(/\n/g," ").replace(/  /g," ").replace(/  /g," ").replace(/  /g," ")

//=============================================================================================
//=============================================================================================
//=============================================================================================
const resPath = (pth) => {
    let _p
    if (!pth.startsWith("/")) {
        _p = pth
        if (pth.startsWith("~/")) {
            pth = `${process.env.HOME}/${pth.substr(2)}`;
        } else {
            pth = `${__dirname}/../../${pth}`;
        }    
    }
    pth = path.normalize(path.resolve(pth));
    if (_p) verbose(`PATH: ${_p} -> ${pth}`)
    return pth;
}

const relativePathIndex = (folder) => {
    if (defaultStaticRoot) {
        let idx = folder.toLowerCase().indexOf(defaultStaticRoot.toLowerCase());
        return idx === 0 ? defaultStaticRoot.length : 0;
    }
}
const parseStatic = (_folder,options = {}) => {
    let prefix = _folder[0].toUpperCase(), tmp, relative = true;
    switch(prefix) {
        case ".": tmp = _folder; break;
        case "~": tmp = `${process.env.HOME}/${_folder.substr(1)}`; relative = false; break;
        case "$": tmp = `${defaultStaticRoot}/${_folder.substr(2)}`; relative = false; break;
        default:  tmp = `${defaultStaticRoot}/${_folder}`; break;
    }
    tmp = tmp.replace(/\/\//g,"/");
    tmp = `/${_.trim(tmp,"/ ")}`;
    // tmp = path.resolve(tmp);
    let folder = path.normalize(tmp), relativeIndex;
    if (relative) {
        if (defaultStaticRoot) {
            if (relativeIndex = relativePathIndex(folder)) {
                folder = folder.substr(relativeIndex);
            }
        }
    }
    verbose(`STATIC-PATH: ${_folder} -> ${folder}`)
    return { folder, prefix, relativeIndex };
}

let certFolder = resPath(configFile.certRoot);
let defaultStaticRoot = ""; 
defaultStaticRoot = parseStatic(configFile.staticRoot || `${__dirname}/../../${configFile.staticRoot}`).folder;

verbose(`[REV-PROXY-FOLDERS]`)
verbose(`    certs  :`,certFolder)
verbose(`    statics:`,defaultStaticRoot)
const loadCerts = (domain) => {
    let domainFilePathAndBase = `${certFolder}/${domain}/${domain}`, key, cert, ca;
    try {
        key = fs.readFileSync(`${domainFilePathAndBase}.key`);
        cert = fs.readFileSync(`${domainFilePathAndBase}.pem`);
        ca = fs.readFileSync(`${domainFilePathAndBase}.ca_bundle`); 
        return { domainFilePathAndBase, key, cert, ca };    
    } catch (err) {
        return {};
    }
}

const ipName = (sitePerms,rqIp) => {
    let rec;
    if (sitePerms) {
        if (!(rec = sitePerms[rqIp])) {    // exact?
            let addrs = [...Object.keys(sitePerms)];
            addrs.some(ipAddr => {      // if not, look for "startsWith" (subnets)
                if (rqIp.startsWith(ipAddr)) {
                    rec = sitePerms[ipAddr] || true;
                    return true;
                }
            })
        }
    }
    if (typeof(rec) === "string") rec = { name: rec };
    return rec;
}

const rqInfo = (rq) => {
    let rqIp = rqIpAddress(rq), name = (ipName(__domainPermissions[rq.hostname],rqIp) || {}).name;
    if (!name || name[0] !== "~") {
        return `[RQ] {${rq.hostname}} ${rq.method} "${rq.url}" -- ${rqIp}${name ? `  (${name})` : ``}`;
    }
}
const echoRequest = (rq,resp,next) => {
    try {
        if (__verbose) {
            let info = rqInfo(rq);
            if (info) logger.log(info);
        }
        next();    
    } catch (err) {
        logger.error(`[ECHO] catch;`,err);
    }
}

const __domainPermissions = {};
let ipRequests = {};
const setupServers = (configFile) => {
    let { domains: targets } = configFile;
    let vHosts = express();
    let sslDomains = {}, router = {};
    let staticDomainPort = configFile.staticPorts || 8100; // starts here.  will be incremented after each addition
    let allowedIpAddresses = configFile.allowedIpAddresses || {};
    let allowedUrlPaths = configFile.allowedUrlPaths || [];
    if (!configFile.commands) configFile.commands = {};
    const cmdFunctions = {
        pset: (rq,resp,next) => { 
            let key = rq.params.key, value = rq.params.value, v;
            if (key && value !== undefined) {
                if (value === "false") parseInt(value) = false;
                else if (value === "true") parseInt(value) = true;
                else if (value === "0") value = 0;
                else if ((v = parseInt(value))) value = v;
                if (['verbose','requestIpExpiresSeconds'].includes(key)) {
                    configFile[key] = value;
                    logger.log(`[PROXY-SETTING] ${key} = ${value} (${typeof(value)})`);    
                }
            }
            resp.end();
            return;
        }
    }
    const ipUsage = (rq,resp,next) => {
        let age = parseInt(configFile.requestIpExpiresSeconds) * 1000;
        if (age) {
            let domain = rq.hostname;
            let now = Date.now();
            let ip = rqIpAddress(rq);
            let ipr = ipRequests[ip];
            let tell;
            if (!ipr) {
                ipr = ipRequests[ip] = {
                    ip,
                    time: now,
                }
                tell = true;
            } else {
                if (ipr.time + age < now) {
                    tell = true;
                }
                ipr.time = now;
            }
            if (tell && !__verbose) {
                // rec = (dom && dom[ip]) || {};
                let rec = ipName(__domainPermissions[domain],ip) || {};
                let name = `(${rec.name || "?"})`;
                let info = rqInfo(rq);
                if (info) logger.log(info)
            }
        }
        next();
    }
    const proxyCmds = (exp,control) => {
        _.forOwn(control,(name,cmd) => {
            if (cmdFunctions[cmd]) {
                if (name === true) name = cmd;
                exp.get(`/${cmd}/:key/:value`,cmdFunctions[cmd])
            }    
        })
    }
    const addServer = (name) => {
        try {
            let targetConfig = targets[name];
            if (targetConfig) {
                let domain, port, target, staticFolders, proxyConfig;
                switch(typeof(targetConfig)) {
                    case "number": targetConfig = { port: targetConfig, target: `http://localhost:${targetConfig}`, }; break;
                    case "string": {
                        if (targetConfig.includes("://")) {                 // redirect to another server
                            let ix = targetConfig.lastIndexOf(":");
                            if (ix>0) {
                                port = parseInt(targetConfig.substr(ix+1));
                            }
                            targetConfig = { port, target: targetConfig, }; break;    
                        } else {                                            // it's a static site
                            targetConfig = { staticFolder: targetConfig };
                        }
                    }
                }
                ({ domain, port, target } = targetConfig);
                staticFolders = targetConfig.staticFolders || targetConfig.staticFolder;
                if (!domain) domain = name;
                let statics = `Static(s)`
                if (configFile.verbose) {
                    logger.log(`[REV-PROXY-SETUP] initializing: {${domain}}`,staticFolders ? `--${statics}--` : ``)
                }

                let siteConfig, dest = "";
                let { key, cert, ca } = loadCerts(domain);
                try {
                    if (key && cert && ca && (target || port || staticFolders)) {
                        // setup the SSL
                        let context = tls.createSecureContext({ key, cert, ca }).context;
                        siteConfig = Object.assign({},targetConfig,{
                            ssl: true,
                            key, cert, ca,
                            context,
                        });
                        let staticDefs = [], staticPorts = [];
                        sslDomains[domain] = siteConfig;
                        // logger.log(`[REV-PROXY-SETUP] sslDomains[${domain}]`)
                        let app = express(), control;
                        // first, deal with permissions (ips for now)
                        let { permissions, errors } = siteConfig;
                        if (!errors) errors = {};
                        if (permissions !== false && allowedIpAddresses) {
                            if (!permissions) permissions = allowedIpAddresses;
                            else verbose(`[SITE-PERMISSIONS]`,JSON.stringify(permissions));
                        }
                        if (permissions) {
                            let { allowedIpAddresses: ipAddresses, safe } = permissions;
                            safe = safe !== false;
                            if (ipAddresses || (safe && allowedIpAddresses)) {
                                if (safe && allowedIpAddresses) { // combine both into one list
                                    if (!ipAddresses) ipAddresses = {};
                                    _.forOwn(allowedIpAddresses,(value,ip) => {
                                        if (!ipAddresses[ip]) {
                                            ipAddresses[ip] = value;
                                        }
                                    })
                                }
                                let sitePerms = {};
                                ipAddresses = _.forOwn(ipAddresses,(value,ip) => {
                                    if (value === true) {
                                        value = { name: "(unknown)" };
                                    } if (typeof(value) === "string") {
                                        value = { name: value };
                                    }
                                    sitePerms[ip] = value;
                                });
                                __domainPermissions[domain] = sitePerms;
                                //================ RUNTIME HANDLER ================                     PERMISSIONS
                                const deniedIps = [];
                                app.use((rq, resp, next) => {
                                    let targetUrl = rq.url;
                                    let rqIp = rqIpAddress(rq), name = (ipName(sitePerms,rqIp) || {}).name;
                                    if (!name) {
                                        // logger.log(`[HMMM] "${rq.hostname}" --- "${rq.url}"`)
                                        if (rq.hostname !== "localhost") {
                                            let allowedPath = false, url = rq.url;
                                            allowedUrlPaths.some(path => {
                                                if (url.includes(path)) {
                                                    return allowedPath = true;
                                                }
                                            })
                                            if (!allowedPath) {
                                                if (!deniedIps[rqInfo]) {
                                                    deniedIps[rqIp] = new Date();
                                                    logger.log(`[PERMISSION] {${domain}} DENIED ip address [${rqIp}] --`,rq.url)
                                                }
                                                resp.status(401).send(`${errors.denied || configFile.pages?.denied || 'Denied'}\n\n${domain}`);
                                                resp.end();
                                                return;
                                            } else {
                                                logger.log(`[PERMISSION] {${domain}} ALLOWED url path:ip address [${rqIp}] --`,rq.url)
                                            }
                                        }
                                    }
                                    next();
                                })
                            }
                        }
                        app.use(helmet());
                        app.use(allowCrossDomain);

                        app.use(ipUsage)
                        if (control = siteConfig.proxyControl) {
                            //================ RUNTIME HANDLER ================                         PROXY COMMANDS
                            proxyCmds(app, control);
                        }
                        app.use(echoRequest);

                        let redirects = siteConfig.redirects || siteConfig.home;
                        if (redirects) {
                            if (typeof(redirects) === "string") redirects = { "/": redirects };
                            // setup redirects from config (key/value pairs -- any key that starts with "/")
                            _.forOwn(redirects,( toPath, fromPath ) => {
                                if (fromPath[0] === "/") {
                                    verbose(`--- Redirect: ${fromPath} -> ${toPath || "<no-where>"}`)
                                    //================ RUNTIME HANDLER ================                 REDIRECTS
                                    app.get(fromPath,(rq,resp,next) => {
                                        verbose(`[REV-PROXY] REDIRECT "${fromPath}" -> "${toPath}"`)
                                        if (toPath) {
                                            resp.redirect(toPath);
                                        }
                                        resp.end();
                                    })
                                }
                            })    
                        }
                        if (staticFolders) {
                            try {
                                let staticRoot; // for each domain, all subs must start with the same root!!!
                                const stdFolderDef = (props,type) => {
                                    if (props) {
                                        let url0, folder, index, status404, staticConfig, def, _root = type === "root";
                                        // let cc, parts, last, idx, _tmp, _folder, _folder0;
                                        switch(typeof(props)) {
                                            case "string":
                                                folder = props;
                                                break;
                                            case "object":
                                                ({ url0, folder, index, status404, staticConfig } = props);
                                                break;
                                        }
                                        if (folder) {
                                            let { folder: _folder, prefix, relativeIndex } = parseStatic(folder), _root;
                                            folder = _folder;
                                            let tmp = parseStatic(siteConfig.root || folder);
                                            _root = tmp.folder;
                                            // if (!staticRoot) 
                                            // {
                                            //     if (relativeIndex) {
                                            //         _root = defaultStaticRoot;
                                            //     } else {
                                            //         _root = folder;
                                            //         folder = "";
                                            //     }    
                                            // } else if (!relativeIndex && prefix === '$') {
                                            //     _root = folder;
                                            // }
                                            def = { url0, folder, index, staticConfig, status404, root: _root };
                                            verbose(`[SITE-DEF] ${name}`,JSON.stringify(def));
                                        }
                                        return def;    
                                    }
                                }
                                let dt = typeof(staticFolders);
                                if (dt === "string") {
                                    let def = stdFolderDef({ url0: "", folder: staticFolders, },"root")
                                    staticDefs.push(def);
                                    staticRoot = def.root;
                                } else {
                                    let tmp = parseStatic(siteConfig.root || staticFolders);
                                    staticRoot = tmp.folder;
                                    if (Array.isArray(staticFolders)) {
                                        staticDefs = staticFolders.map(f=>stdFolderDef(f,"array"));
                                    } else {
                                        _.forOwn(staticFolders,(value,url0) => {
                                            let folder, status404, staticConfig;
                                            if (value) {
                                                if (typeof(value) === "string") {
                                                    folder = value;
                                                } else {
                                                    ({ folder, status404, staticConfig } = value);
                                                }
                                                if (folder) {
                                                    let def = stdFolderDef({ url0, folder, status404, staticConfig },"object");
                                                    staticDefs.push(def)    
                                                }
                                            }
                                        });
                                    }
                                }
                                // logger.log(`[REV-PROXY] {${domain}} static sites:`,defs.length)
                                //
                                //--- at this point we have all the static folder routing
                                //
                                if (staticDefs.length) {
                                    app.use((rq,resp,next) => {
                                        let targetUrl = rq.url, done;
                                        staticDefs.some(def => {
                                            let { url0, folder, index, status404, staticConfig, root: _root } = def;
                                            const makeUrl = () => {
                                                let url = '', eol = targetUrl.substr(url0.length);
                                                let redirect;
                                                if (!folder) {
                                                    url = path.normalize(`${folder || ""}`);
                                                } else {
                                                    if (folder.startsWith(_root)) {
                                                        let fldr = folder.substr(_root.length);
                                                        if (fldr && targetUrl.lastIndexOf("/") < 1) {
                                                            url = `${fldr}/${index || "index.html"}`;
                                                            redirect = true;
                                                        }
                                                    }
                                                }
                                                if (url) {
                                                    if (redirect) {
                                                        resp.redirect(url);
                                                        return true;
                                                    } else {
                                                        url += `/${eol || index || "index.html"}`;
                                                        url = `/${_.trimStart(url,"/ ")}`;
                                                        rq.__old = targetUrl;
                                                        rq.__def = def;
                                                        rq.url = url;
                                                        return false;
                                                    }
                                                }
                                            }
                                            if (!url0 || targetUrl.startsWith(url0)) {
                                                let result = makeUrl();
                                                switch (result) {
                                                    case true: done = true; return true;
                                                    case false: return true;
                                                }
                                            }
                                        });
                                        if (next && !done) {
                                            next();
                                        }
                                    })
                                    const _staticDef = Object.assign({
                                        index: false,
                                        fallthrough: false,
                                        dotfiles: "deny",
                                    } );
                                    if (configFile.staticHeaders) {
                                        const staticHeaders = configFile.staticHeaders;
                                        const cspSites = configFile.cspSites || targetConfig.cspSites;
                                        _staticDef.setHeaders = (res,path,stat) => {
                                            Object.keys(staticHeaders).forEach(key => {
                                                let value = staticHeaders[key];
                                                switch(key) {
                                                    case "Content-Security-Policy":
                                                        switch (value) {
                                                            case true: 
                                                                if (targetConfig.csp) {
                                                                    value = targetConfig.csp;
                                                                } else {
                                                                    value = __csp;
                                                                    if (cspSites) {
                                                                        value = value.replace(/{{sites}}/g,cspSites);
                                                                    }
                                                                }
                                                                break;
                                                            default:
                                                                if (typeof(value) !== "string") {
                                                                    value = null;
                                                                }
                                                        } 
                                                        break;
                                                }
                                                if (value) {
                                                    res.setHeader(key,value)
                                                }
                                            })
                                        }
                                    }
                                    if (!staticRoot) {
                                        staticRoot = defaultStaticRoot;
                                    }
                                    verbose(`================== ${domain} - Using static:`,staticRoot)
                                    app.use(serveStatic(staticRoot,_staticDef));
                                    verbose(`[STATIC-SITE] {${domain}} (localhost:${staticDomainPort})]\n  -- root: "${staticRoot}"\n  --  def: ${JSON.stringify(_staticDef)}`);    
                                    app.use(async (err,rq,resp,next) => {
                                        let str = "";
                                        if (rq.__def) {
                                            let { url0, folder, status404, staticConfig, root: _root } = rq.__def;
                                            let tmp = status404 || "";
                                            str = tmp.replace("{{URL}}",rq.url).trim();
                                            let eCaption = "\n------ error msg:\n err:";
                                            let replied = str ? `\n------ replied: ${str}` : ``;
                                            let domainFolder = path.normalize(path.resolve(`${_root}/${folder}`));
                                            let errMsg = err, customMsg;
                                            try {
                                                if (err.toString().includes("ENOENT")) {
                                                    customMsg = `[FILE-NOT-FOUND] (${rqIpAddress(rq)}) "${domain}": "${err.path}"`;
                                                }
                                            } catch (zz) {
                                                errMsg = err;
                                            }
                                            if (customMsg) {
                                                logger.log(customMsg)
                                            } else {
                                                let logStr = `[STATIC-ERR] "${domain}": "${domainFolder}" [${rqIpAddress(rq)}]:`;
                                                if (replied) logStr += replied;
                                                if (eCaption) logStr += eCaption;
                                                logger.log(logStr,errMsg)
                                            }
                                            if (str === tmp) str = `${tmp}\n\n"${rq.url}"`;
                                        } else {
                                            str = "Huh? (no def)"
                                        }
                                        resp.status(404).end(str);;
                                    });
                                    verbose(`[STATIC-SITE] {${domain}} (localhost:${staticDomainPort})`);    
                                    staticPorts.push(port = staticDomainPort);
                                    app.listen(staticDomainPort++);
                                } else {
                                    logger.error(`[STATIC-DOMAIN] {${domain}} -- no staticFolder defs!`)
                                }
                            } catch (err) {
                                logger.error(`[STATIC-SITE] -- staticFolders.catch;`,err)
                            }
                        } else {
                        }
                        vHosts.use(vhost(domain,app));
                        if (!target) {
                            if (port) {
                                dest = siteConfig.target = target = `http://localhost:${port || 80}`;
                            } else if (staticDefs.length) {
                                siteConfig.target = target = `http://localhost`;
                                dest = `Static${staticDefs.length > 1 ? `s (${staticDefs.length})`:""} (${staticPorts.join(",")})`;
                            }
                        } else {
                            dest = target;
                        }
                        siteConfig.dest = dest;
                        // setup the proxy
                        let fnProxyFilter = (pathname,req) => { return (req.hostname === domain); }

                        proxyConfig = { 
                            target, 
                            xfwd: true,
                            logLevel:  __verbose ? "info" : "warn",
                            // router,
                            changeOrigin: true,
                            // ws: true,
                        }
                        let middleWare = createProxyMiddleware(fnProxyFilter,proxyConfig);
                        vHosts.use(middleWare);
                    }    
                } catch (err) {
                    logger.log(`[SERVER] (${domain}) ${err} fail:`,err)
                }
                if (siteConfig) {
                    verbose(`[REV-PROXY-SERVER] ADDED {${domain}} ${siteConfig.ssl ?  "-> " : ""}${dest ? `"${dest}"` : ""}`,proxyConfig)
                    verbose(`\n-----------`);
                } else {
                    logger.log(`[REV-PROXY-SERVER] *** SSL-FAILED *** {${domain}}`,targetConfig,"\n-----------");
                }
            } else {
                logger.log(`[REV-PROXY-SERVER] ADD - no config for:`,name)
            }
        } catch (err) {
            logger.log(`[REV-PROXY-SERVER] setupServers.catch:${name};`,err);
        }
    };

    Object.keys(targets).forEach(key => addServer(key));
    return {
        vHosts,
        sslDomains,
    }
}

let httpsServer;
const startServer = (cfg) => {
    let { vHosts, httpPort, sslPort, sslDomains, } = cfg;
    if (!vHosts) {
        logger.log("[REV-PROXY-SERVER] missing entry point config (servers: { proxy: { ...} }");
        process.exit(-1);
    }
    if ((!sslDomains || ![...Object.keys(sslDomains)].length)) {
        logger.log("[REV-PROXY-SERVER] no domains to proxy");
        process.exit(-1);
    }
    // vHosts.use(echoRequest)
    // http server to redirect to https...
    httpPort = 6543;
    const deniedDomains = {};
    var httpOptions = {
        SNICallback: function (domain, cb) {
            let site = sslDomains[domain]
            if (site === undefined) {
                logger.log(`[REV-PROXY-ERROR] {${domain}} -- no VHost target for domain.`);
                cb(new Error("site domain name not found"), null);
            } else {
                cb(null, site.context);
            }
        },
        // minVersion: "TLSv1.2",
        // maxVersion: "TLSv1.2",
    };

    if (httpPort) {

        httpServer.createServer(httpOptions,function (rq, resp) {
            let domain;
            try {
                domain = rq.headers['host'];
                if (rq.url.includes("/.well-known/")) {

                } else {
                    if (sslDomains[domain]) {
                        logger.log(`[HTTP] {${domain}} -> "${rq.url}"`);
                        resp.writeHead(301, { "Location": `https://${domain}${rq.url}`});
                        resp.end();
                    } else {
                        if (!deniedDomains[domain]) {
                            deniedDomains[domain] = new Date();
                            logger.log(`[HTTP] DOMAIN: {${domain}} -- DENIED`);
                        }
                        resp.end("Peace be with you.")
                    }    
                }
            } catch (err) {
                logger.error(`[HTTP] {${domain}} HTTP.catch;`,err)
            }
        }).listen(httpPort); // port 80 gets routed to this server's port 6543

        logger.log(`[PROXY] created http server on port:`,httpPort)
    }

    // HTTPS Server
    var httpsOptions = {
        SNICallback: function (domain, cb) {
            // logger.log(`[REV-PROXY] "${domain}"`)
            let site = sslDomains[domain]
            if (site === undefined) {
                logger.log(`[REV-PROXY-ERROR] {${domain}} -- no VHost target for domain.`);
                cb(new Error("site domain name not found"), null);
            } else {
                cb(null, site.context);
            }
        },
        // minVersion: "TLSv1.2",
        // maxVersion: "TLSv1.2",
    };

    httpsServer = https.createServer(httpsOptions, vHosts);
    httpsServer.listen(sslPort, function () {
        logger.log("--------------------------------------------------------");
        logger.log(`GREL Reverse Proxy Server -- local port ${sslPort}`);
        let domain;
        for (domain in sslDomains) {
            let { target, dest } = sslDomains[domain];
            logger.log(`    {${domain}} -> "${dest}"`)
        }
        logger.log("--------------------------------------------------------");
    });
}

//=============================================================================================
//=============================================================================================
//=============================================================================================

let { vHosts, sslDomains, } = setupServers(configFile);

startServer({
    vHosts,
    sslPort: configFile.port,
    httpPort: configFile.httpPort,
    sslDomains,
});
