# grel-reverse-proxy

# Reverse Proxy Server

Setup an HTTPS reverse proxy server on your desktop to expose static and dynamic sites.
Supports SSL certificates.  No Code, just config!

I was frustrated with the available options, and didn't want to use NGINX locally.
I wanted one that was node based, but used a config file, and allowed me to customize.  This is the result. It's been working on my desktop (with 10 domains) since 2019.

## Use Cases

- You have various local servers running on different ports, and you want to provide HTTPS access to them without having to expose the ports.
- You also have various static content that you want to serve using different virtual paths.
- You have one or more domain names to use:
    - Some are dynamic, and have their own projects.
    - Some are simply static sites, which just need to server files (no need for separate projects)
- You want to be able to control access to some sites based on ip addresses
    - You want to allow certain paths regardless of access control (e.g., domain ownership checks)

## Installing

### NPM

```sh
npm install "grel-reverse-proxy"
```

### GitHub

```sh
git clone "https://github.com/grumpygary/grel-reverse-proxy"
```

# Usage

## Simple Config
```
// proxy-config.js
// For more examples, see 'sample-config.js' below and in module source
module.exports = {
    certRoot: "~/my-certs",
    staticRoot: "~/static-www-sites", // referenced by "$" below
    domains: {
        "sub.mydomain.com": {
            staticFolder: "$/sub-domain",
            home: "/index.html", // from root of static folder
        },
  },
}
```

## Running the Server
```
const revProxyServer = require('grel-reverse-proxy');
let configOptions; // if undefined, will use "proxy-config.js" in cwd
revProxyServer(configOptions); // run server --  see below
```

## Configuration Options

Under construction.  See sample-config.js for context.

```
Global options
------------------------|----------|-------------|-------------------------------------------------
name                    | type     | default     | description
------------------------|----------|-------------|-------------------------------------------------
verbose                 | bool     | false       | log config msgs during startup
staticHeaders           | object   |             | applied to every response (Content-Security-Policy: true or string -- if includes {{sites}} can customize by domain)
certRoot                | string   |             | REQUIRED. Where to find domins certs (names domain folders with .crt .ey and .ca_bundle files)
staticRoot              | string   |             | If using static folders, the folder where static folders are placed (when using "$" & "~")
staticPorts             | number   | 8100        | first port for static sites
port                    | number   | 443         | 
requestIpExpiresSeconds | number   | 30          | Don't log ip addr after this timeout
domains                 | object   |             | domain targets { "domain.com": {}, ... }
allowedIpAddressed      | object   |             | { "::ffff:xxx.xxx": "name" ...} , match beginning of string
allowedUrlPaths         | array    |             | if request url's beginning matches any of these, allow regardless of permissions (useful for domain name ownership files)
pages                   | object   |             | { "statusNNN": htmlBodyForPage, ..., "denied": "access denied" }
------------------------|----------|-------------|-------------------------------------------------
Domain specific options
------------------------|----------|-------------|-------------------------------------------------
root                    | string   |             | root folder of domain: $=staticRoot
staticFolders           | array    |             | specific sites based on url path
staticFolder            | string   |             | site specific root ($ = staticRoot, ~ = user)
redirects               | object   |             | { "request-url": "mapped-url" }
proxyControl            | object   |             | { pset: true } allows remote set,reload (careful!)
port                    | number   |             | localhost port
target                  | string   |             | url of server (using "port" = "https://localhost:port )
permissions             | object   |             | see permissions
errors                  | object   |             | { denied: "string if ppermission denied" } (more to come)
cspSites                | string   |             | if {{sites}} is in the CSP, replce with these
```

### Permissions
```
------------------------|----------|-------------|-------------------------------------------
safe                    | bool     | true        | when false, enforce permissions
allowedIpAddressed      | object   |             | site version of global option
```

### Sample-Config.js

*Some configuration samples.*
```
const allowedIpAddresses = {
    // subnets
    "::ffff:192.168.1.": "~Local-LAN",
    "::ffff:17.": "Apple",
};
const allowedUrlPaths = [
    ".well-known/pki-validation",
];

module.exports = {
    verbose: true,  // useful for debugging config
    certRoot: "", // each domain in names folder; include: domain.crt, domain.key, domain.ca_bundle (rename it)
    staticRoot: "",
    staticPorts: 8100,  // internal: auto-assign base
    port: 443,          // exposed externally
    allowedIpAddresses,
    allowedUrlPaths,
    requestIpExpiresSeconds: 30, // seconds
    staticHeaders: {
        "Content-Security-Policy": true, // use default (pass your own object to override)
    },
    domains: {
        // domains redirecting to other servers
        "domain.com": {
            root: "$", // staticRoot
            staticFolders: [
                { url0: "/urlPart", folder: "$/localFolder", index: "index.html", },
                { url0: "/files", folder: "$/downloads" },
                { url0: "/", folder: "$/local2", index: "index.html", },
            ],
            proxyControl: {
                pset: false, // when true, will use pset to manage proxy remotely (careful!)
            },
        },
        "anotherdomain.com": {
            staticFolder: "~/site1/dist-web", // static off staticRoot
            redirects: {
                "/": "/index.html", // redirect / to /index.html
            },
        },
        "sub2.domain.com": {
            target: "http://localhost:8888", // dynamic (include "://")
            permissions: {
                safe: false,
                allowedIpAddresses: Object.assign({},allowedIpAddresses,{
                }),
            },
            errors: {
                denied: "IP address not allowed.",
            }
        },
        "sub3.domain.com": {
            port: 8897,
            target: "http://localhost:8897",
            home: "/p/index.html", // same as redirects: { "/": "/newPath" }
        },
        "sub4.domain.com": 8877, // will use "http://localhost:8877"
  },
    pages: {
        status404: `
<div style="background-color:blue;color:white;padding:5px;width:500px;">
    <div style="border:1px solid #ffff00;padding:10px;">
    404 - Can't fetch this!
    <br/>
    {{URL}}
    </div>
</div>`,
        denied: ``,
    },
}```
