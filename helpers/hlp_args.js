"use strict";


exports.getArgs = function getArgs () {
    //https://stackoverflow.com/questions/4351521/how-do-i-pass-command-line-arguments-to-a-node-js-program
    //node test.js -D --name=Hello

    const args = {}
    process.argv
      .slice(2, process.argv.length)
      .forEach( arg => {
        // long arg
        if (arg.slice(0,2) === '--') {
          const longArg = arg.split('=')
          args[longArg[0].slice(2,longArg[0].length)] = longArg[1]
        }
       // flags
        else if (arg[0] === '-') {
          const flags = arg.slice(1,arg.length).split('')
          flags.forEach(flag => {
            args[flag] = true
          })
        }
      })
    return args
}