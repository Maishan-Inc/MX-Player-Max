import assert from 'node:assert/strict'
import * as browser from '@mx-player-max/browser'
import * as react from '@mx-player-max/react'
import * as sdk from '@mx-player-max/sdk'
import * as ui from '@mx-player-max/ui'
import * as vue from '@mx-player-max/vue'

assert.equal(typeof browser.create, 'function')
assert.equal(typeof browser.MXPlayer, 'function')
assert.equal(typeof browser.attachPlayerUi, 'function')
assert.equal(typeof sdk.MXPlayer, 'function')
assert.equal(typeof ui.attachPlayerUi, 'function')
assert.ok(react.MXPlayer)
assert.ok(vue.MXPlayer)
