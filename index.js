'use strict';
module.exports = Scuttlebutt
var EventEmitter = require('events').EventEmitter
  , inherits = require('util').inherits
  , u = require('./util')
  , timestamp = require('monotonic-timestamp')
  , Duplex = require('stream').Duplex

function dutyOfSubclass() {
  throw new Error('method must be implemented by subclass')
}

function validate(data) {
  return Array.isArray(data)
      && 'number' === typeof data[1]
      && 'string' === typeof data[2]
      && '__proto__' !== data[2]
}

inherits(Scuttlebutt, EventEmitter)
function Scuttlebutt(opts) {
  if (!(this instanceof Scuttlebutt)) return new Scuttlebutt(opts)
  var id = 'string' === typeof opts ? opts : opts && opts.id
  this.setMaxListeners(Number.MAX_VALUE)

  this._streams = 0
  this.setId(id || u.createId())

  this.sources = {}
}

var sb = Scuttlebutt.prototype
  , emit = EventEmitter.prototype.emit

sb.applyUpdate = dutyOfSubclass
sb.history = dutyOfSubclass

sb.setId = function(id) {
  if ('__proto__' === id) throw new Error('__proto__ is invalid id')
  if (id == null) throw new Error('null is not invalid id')
  this.id = id
  return this
}

sb.localUpdate = function(trx) {
  this._update([trx, timestamp(), this.id])
  return this
}

sb._update = function(update) {
  //validated when it comes into the stream
  var ts = update[1]
  var source = update[2]
  //if this message is old for it's source,
  //ignore it. it's out of order.
  //each node must emit it's changes in order!
  var latest = this.sources[source]
  if (latest && latest >= ts) return false

  this.sources[source] = ts

  if (this.applyUpdate(update)) {
    emit.call(this, '_update', update) //write to stream.
    return true
  }

  return false
}

sb.createStream = function(opts) {
  return new ScuttlebuttStream(this, opts || {})
}

sb.createReadStream = function(opts) {
  opts = opts ? Object.create(opts) : {}
  opts.writable = false
  return new ScuttlebuttStream(this, opts || {})
}

sb.createWriteStream = function(opts) {
  opts = opts ? Object.create(opts) : {}
  opts.readable = false
  return new ScuttlebuttStream(this, opts || {})
}

sb.clone = function() {
  var A = this
    , B = new A.constructor()
  B.setId(A.id) //same id. think this will work...
  A._clones = (A._clones || 0) + 1

  var a = A.createStream()
    , b = B.createStream()

  a.pipe(b).pipe(a)

  return B
}

sb.dispose = function() {
  emit.call(this, 'dispose')
}

var RX = 0
  , RX_FRESH = RX++
  , RX_SYNCING = RX++

var TX = 0
  , TX_FRESH = TX++
  , TX_SYNCING = TX++

inherits(ScuttlebuttStream, Duplex)
function ScuttlebuttStream(scuttlebutt, opts) { var self = this
  Duplex.call(this,
  { objectMode: true
  , readable: opts.readable
  , writable: opts.writable
  })

  this._obj = scuttlebutt
  self._obj._streams++
  this.sources = {}

  this.rxState = RX_FRESH
  this.txState = TX_FRESH

  if (this.readable) {
    var data = { id: this.id, clock: this._obj.sources }
    if (opts.meta) data.meta = opts.meta
    this.push(data)

    if (opts.tail === false)
      this.on('sync', function() { self.push(null) })
  }

  if (!this.writable) {
    this._write({ clock: {} }, null, throw_)
    this._write('SYNC', null, throw_)
  }

  this._obj.once('dispose', dispose)

  this.once('finish', function() {
    this.removeListener('dispose', dispose)
    setImmediate(function() {
      if (self.readable) {
        if (self._onUpdate)
          self._obj.removeListener('_update', self._onUpdate)
        self.push(null)
      }
      self.emit('close')
      emit.call(self._obj, 'unstream', --self._obj._streams)
    })
  })

  function dispose() {
    console.log(self._obj.id, 'DISPOSE')
    self.end()
  }
}

ScuttlebuttStream.prototype.push = function(data) {
  console.log(this._obj.id, 'tx', this.rxState, this.txState, data)
  return Duplex.prototype.push.apply(this, arguments)
}

// rx_update
ScuttlebuttStream.prototype._write = function(data, _, cb) { var self = this
  console.log(this._obj.id, 'rx', this.rxState, this.txState, data)

  if (this.rxState === RX_FRESH) {
    if ( !data
      || typeof data != 'object'
      || !data.clock
      || typeof data.clock != 'object'
       ) return cb(new TypeError('invalid handshake'))

    console.log(this._obj.id, this.rxState = RX_SYNCING, this.txState)
    emit.call(this, 'header', data)

    if (this.readable) {
      console.log(this._obj.id, this.rxState, this.txState = TX_SYNCING)

      var sources = data.clock

      this._obj
        .history(sources)
        .forEach(this._send, this)

      console.log(this._obj.id, this.rxState, this.txState = TX)

      if (this.writable) {
        this.push('SYNC')
        emit.call(this, 'syncSent')
      }

      this._obj.on('_update', this._onUpdate = function(update) {
        console.log(self._obj.id, self.rxState, self.txState, '_update', update)
        if (!u.filter(update, self.sources)) return
        self._send(update)
      })
    }
  }
  else if (this.rxState === RX_SYNCING) {
    if (data !== 'SYNC')
      return this._receive(data, cb)
    else {
      console.log(this._obj.id, this.rxState = RX, this.txState)

      emit.call(this, 'sync')
      emit.call(this, 'synced')
    }
  }
  else if (this.rxState === RX)
    return this._receive(data, cb)

  cb()
}

ScuttlebuttStream.prototype._receive = function(data, cb) {
  console.log(this._obj.id, 'rx_update', this.rxState, this.txState, data)

  if (validate(data)) {
    this._obj._update(data)
    this._count(data)
    cb()
  }
  else
    cb(new TypeError('invalid update'))
}


ScuttlebuttStream.prototype._read = function() {}

ScuttlebuttStream.prototype._send = function(update) {
  this.push(update)
  this._count(update)
}

ScuttlebuttStream.prototype._count = function(update) {
  var ts = update[1]
    , source = update[2]
  this.sources[source] = ts
}

function throw_(err) {
  if (err) throw err
}
