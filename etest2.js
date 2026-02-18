// Try different require approaches
try {
  const e = require('electron/main')
  console.log('electron/main type:', typeof e, e && typeof e === 'object' ? Object.keys(e).slice(0,5).join(',') : e)
} catch(err) { console.log('electron/main error:', err.message) }

// Check if electron is a builtin
const Module = require('module')
console.log('builtins include electron:', Module.builtinModules.includes('electron'))
console.log('first 5 builtins:', Module.builtinModules.slice(0,5).join(','))

// Try process._linkedBinding
try {
  const binding = process._linkedBinding && process._linkedBinding('electron_browser_app')
  console.log('_linkedBinding app:', typeof binding)
} catch(e2) { console.log('_linkedBinding error:', e2.message) }

process.exit(0)
