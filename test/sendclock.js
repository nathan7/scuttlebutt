var Model = require('../model')

var a = Model('A')
var b = Model('B')
var c = Model('C')

var tape = require('tape')

tape('send clock', function (t) {

  var s1 = a.createStream({writable: false, sendClock: true})
  var s2 = b.createStream({readable: false, sendClock: true})

  s1.pipe(s2).pipe(s1)

  a.set('foo', 'bar')
  setTimeout(function() {
    console.log(b.get('foo'))

    t.equal(b.get('foo'), 'bar')

    b.set('foo', 'baz')
    setTimeout(function() {
      //b has changed locally
      t.equal(b.get('foo'), 'baz')
      //a has NOT changed
      t.equal(a.get('foo'), 'bar')

      //set a again
      a.set('foo', 'bar')
      setTimeout(function() {
        //b has changed locally
        t.equal(b.get('foo'), 'bar')

        var s3 = b.createStream({writable: false, sendClock: true})
        var s4 = c.createStream({readable: false, sendClock: true})

        s3.pipe(s4).pipe(s3)

        setTimeout(function() {
          t.equal(b.get('foo'), 'bar')

          t.end()
        }, 10)
      }, 10)
    }, 10)
  }, 10)
})
