const e = require("electron"); console.log("type:", typeof e); console.log("keys:", e && typeof e === "object" ? Object.keys(e).slice(0,10) : String(e).slice(0,100)); process.exit(0)
