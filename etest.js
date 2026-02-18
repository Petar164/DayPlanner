const e = require('electron')
console.log('type:', typeof e)
if (typeof e === 'object') {
  console.log('keys:', Object.keys(e).slice(0,8).join(','))
  console.log('app:', typeof e.app)
} else {
  console.log('value:', e)
}
process.exit(0)
