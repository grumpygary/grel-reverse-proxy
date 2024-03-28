# grel-reverse-proxy

# Reverse Proxy Server

Setup a proxy on your desktop to expose static and dynamic sites.
Supports SSL certificates.  No Code, just config!

## Use Cases

- Various node servers running on different ports, and you want to provide HTTPS access to them without having to expose the ports.
- You also have various static content that you want to server using different virtual paths.
- You have one or more domain names to use, each one of which can have:
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

# 

## Configuration Object

The 
Under construction.  See sample-config.js for context.

```
Global options
------------------------|----------|-------------|-------------------------------------------------
name                    | type     | default     | description
------------------------|----------|-------------|-------------------------------------------------
verbose                 | bool     | false       | log config msgs during startup
staticHeaders           | object   |             | applied to every response (Content-Security-Policy: true or string -- if includes {{sites}} can customize by domain)
certRoot                | string   |             | where to find domins certs (names domain folders with .crt .ey and .ca_bundle files)
staticRoot              | string   |             | folder where static folders are placed (when using "$" & "~")
staticPorts             | number   | 8100        | first post for static sites
port                    | number   | 443         | 
requestIpExpiresSeconds | number   | 30          | don't log ip addr after this timeout
domains                 | object   |             | domains targets
allowedIpAddressed      | object   |             | { "::ffff:xxx.xxx": "name" ...} , match beginning of string
allowedUrlPaths         | array    |             | if request url's beginning matches any of these, allow regardless of permissions
pages                   | object   |             | { "statusNNN": htmlBodyForPage, ..., "denied": "access denied" }
------------------------|----------|-------------|-------------------------------------------------
Domain specific options
------------------------|----------|-------------|-------------------------------------------------
root                    | string   |             | root folder of domain: $=staticRoot
staticFolders           | array    |             | specific sites based on url path
staitcFolder            | string   |             | site specific root ($ = staticRoot, ~ = user)
redirects               | object   |             | { "request-url": "mapped-url" }
proxyControl            | object   |             | { pset: true } allows remote set,reload (careful!)
port                    | number   |             | localhiost port
target                  | string   |             | url of server (using "port" = "https://localhost:port )
permissions             | object   |             | see permissions
errors                  | object   |             | { denied: "string if ppermission denied" } (more to come)
cspSites                | string   |             | if {{sites}} is in the CSP, replce with these


```

### Permissions

```
--------------------|----------|-------------|-------------------------------------------
safe                | bool     | true        | when false, enforce permissions
allowedIpAddressed  | object   |             | site version of global option
```

## Usage (example)

```
```
