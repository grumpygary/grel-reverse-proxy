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
}