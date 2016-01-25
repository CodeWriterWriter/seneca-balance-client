/*
  MIT License,
  Copyright (c) 2015, Richard Rodger and other contributors.
*/

'use strict'

var _ = require('lodash')
var Eraro = require('eraro')
var Jsonic = require('jsonic')

var error = Eraro({
  package: 'seneca',
  msgmap: {
    // TODO: error code messages
  }
})


module.exports = balance_client

var target_map

balance_client.preload = function () {
  var seneca = this

  target_map = {}

  seneca.options({
    transport: {
      balance: {
        handle: function ( pat, action ) {
          add_target( seneca, target_map, pat, action )
        }
      }
    }
  })
}

function balance_client (options) {
  var seneca = this
  var tu = seneca.export('transport/utils')
  var modelMap = {
    publish: publishModel,
    actor: actorModel
  }

  // Merge default options with any provided by the caller
  options = seneca.util.deepextend({}, options)

  // fix for Seneca 1.0.0
  if ('1.0.0' === seneca.version) {
    target_map = {}
    seneca.options({
      transport: {
        balance: {
          handle: function ( pat, action ) {
            add_target( seneca, target_map, pat, action )
          }
        }
      }
    })
  }

  var model = options.model

  if (model === undefined) {
    model = modelMap.actor
  }
  else if (typeof model === 'string') {
    model = modelMap[model]
  }

  if (typeof model !== 'function') {
    throw new Error('model must be a string or function')
  }

  seneca.add({
    role: 'transport', hook: 'client', type: 'balance'
  }, hook_client)

  seneca.add({
    role: 'transport', type: 'balance', add: 'client'
  }, add_client)

  seneca.add({
    role: 'transport', type: 'balance', remove: 'client'
  }, remove_client)


  function remove_target ( pat, action_id ) {
    var patkey = make_patkey( seneca, pat )
    var targetdesc = target_map[patkey]

    targetdesc = targetdesc || { index: 0, targets: [] }
    target_map[patkey] = targetdesc

    for ( var i = 0; i < targetdesc.targets.length; i++ ) {
      if ( action_id === targetdesc.targets[i].id ) {
        break
      }
    }

    if ( i < targetdesc.targets.length ) {
      targetdesc.targets.splice(i, 1)
      targetdesc.index = 0
    }
  }


  function add_client (msg, done) {
    if ( !msg.config.id ) {
      msg.config.id = this.util.pattern( msg.config )
    }

    this.client( msg.config )
    done()
  }


  function remove_client (msg, done) {
    if ( !msg.config.id ) {
      msg.config.id = this.util.pattern( msg.config )
    }

    remove_target( msg.config.pin, msg.config.id )

    done()
  }


  function hook_client (args, clientdone) {
    var type = args.type
    var client_options = seneca.util.clean(_.extend({}, options[type], args))

    var model = client_options.model || actorModel
    model = _.isFunction(model) ? model : ( modelMap[model] || actorModel )

    tu.make_client(make_send, client_options, clientdone)

    function make_send (spec, topic, send_done) {
      seneca.log.debug('client', 'send', topic + '_res', client_options, seneca)

      send_done(null, function (args, done) {
        var patkey = args.meta$.pattern
        var targetdesc = target_map[patkey]

        if ( targetdesc ) {
          model(this, args, targetdesc, done)
          return
        }

        else return done( error('no-target') )
      })
    }

    seneca.add('role:seneca,cmd:close', function (close_args, done) {
      var closer = this
      closer.prior(close_args, done)
    })
  }


  function publishModel (seneca, args, targetdesc, done) {
    if ( 0 === targetdesc.targets.length ) {
      return done(error('no-current-target'))
    }

    var first = true
    for ( var i = 0; i < targetdesc.targets.length; i++ ) {
      var target = targetdesc.targets[i]
      target.action.call(seneca, args, function () {
        if ( first ) {
          done.apply(seneca, arguments)
          first = false
        }
      })
    }
  }


  function actorModel (seneca, args, targetdesc, callback) {
    var targets = targetdesc.targets
    var index = targetdesc.index

    if (!targets[index]) {
      targetdesc.index = 0
      return callback( error('no-current-target') )
    }

    targets[index].action.call( seneca, args, callback )
    targetdesc.index = ( index + 1 ) % targets.length
  }
}


// TODO: handle duplicates
function add_target ( seneca, target_map, pat, action ) {
  var patkey = make_patkey( seneca, pat )
  var targetdesc = target_map[patkey]

  targetdesc = targetdesc || { index: 0, targets: [] }
  target_map[patkey] = targetdesc
  targetdesc.targets.push( { action: action, id: action.id } )
}


function make_patkey ( seneca, pat ) {
  if ( _.isString( pat ) ) {
    pat = Jsonic(pat)
  }

  var keys = _.keys(seneca.util.clean(pat)).sort()
  var cleanpat = {}

  _.each( keys, function (k) {
    cleanpat[k] = pat[k]
  })

  var patkey = seneca.util.pattern( cleanpat )
  return patkey
}
