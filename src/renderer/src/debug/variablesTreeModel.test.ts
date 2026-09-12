import { describe, expect, it } from 'vitest'
import type { DebugScope, DebugVariable } from '@shared/debug'
import {
  INITIAL_VARIABLES_TREE,
  applyChildrenResult,
  applyScopesResult,
  collapseNode,
  expandNode,
  flattenVariablesSubtree,
  flattenVariablesTree,
  needsChildren,
  selectInitialScopeHandle
} from './variablesTreeModel'

function scope(name: string, handle: string | null, expensive = false): DebugScope {
  return { handle, name, kind: 'other', expensive, namedCount: null, indexedCount: null }
}

function variable(name: string, handle: string | null, value = ''): DebugVariable {
  return { handle, name, value, type: null, kind: 'other', namedCount: null, indexedCount: null }
}

const SCOPES = [scope('Locals', 'dv-1'), scope('Globals', 'dv-2', true), scope('Empty', null)]

function withScopes() {
  return applyScopesResult(INITIAL_VARIABLES_TREE, { status: 'ok', scopes: SCOPES })
}

function describeRows(state: ReturnType<typeof withScopes>): string[] {
  return flattenVariablesTree(state).map((row) => {
    const indent = '  '.repeat(row.depth)

    switch (row.kind) {
      case 'scope':
        return `${indent}${row.expanded ? '-' : '+'} ${row.scope.name}`
      case 'variable':
        return `${indent}${row.variable.handle === null ? '·' : row.expanded ? '-' : '+'} ${row.variable.name}`
      case 'notice':
        return `${indent}(${row.notice}${row.reason === null ? '' : `:${row.reason}`})`
    }
  })
}

describe('variables tree model', () => {
  it('shows nothing until scopes arrive, then collapsed scopes', () => {
    expect(flattenVariablesTree(INITIAL_VARIABLES_TREE)).toEqual([])
    expect(describeRows(withScopes())).toEqual(['+ Locals', '+ Globals', '+ Empty'])
  })

  it('auto-expands only the first non-expensive scope that has a handle', () => {
    expect(selectInitialScopeHandle(SCOPES)).toBe('dv-1')
    expect(
      selectInitialScopeHandle([scope('Globals', 'dv-2', true), scope('None', null)])
    ).toBeNull()
  })

  it('expands lazily: loading → children, with leaves and nested nodes', () => {
    let state = expandNode(withScopes(), 'dv-1')

    expect(needsChildren(withScopes(), 'dv-1')).toBe(true)
    expect(describeRows(state)).toEqual(['- Locals', '  (loading)', '+ Globals', '+ Empty'])

    state = applyChildrenResult(state, 'dv-1', {
      status: 'ok',
      variables: [variable('count', null, '3'), variable('user', 'dv-3')],
      truncated: false
    })

    expect(describeRows(state)).toEqual([
      '- Locals',
      '  · count',
      '  + user',
      '+ Globals',
      '+ Empty'
    ])

    state = expandNode(state, 'dv-3')
    state = applyChildrenResult(state, 'dv-3', {
      status: 'ok',
      variables: [variable('name', null)],
      truncated: false
    })

    expect(describeRows(state)).toEqual([
      '- Locals',
      '  · count',
      '  - user',
      '    · name',
      '+ Globals',
      '+ Empty'
    ])
  })

  it('collapses without dropping loaded children, and re-expands without refetching', () => {
    let state = expandNode(withScopes(), 'dv-1')
    state = applyChildrenResult(state, 'dv-1', {
      status: 'ok',
      variables: [variable('count', null)],
      truncated: false
    })
    state = collapseNode(state, 'dv-1')

    expect(describeRows(state)).toEqual(['+ Locals', '+ Globals', '+ Empty'])
    expect(needsChildren(state, 'dv-1')).toBe(false)

    state = expandNode(state, 'dv-1')
    expect(describeRows(state)).toEqual(['- Locals', '  · count', '+ Globals', '+ Empty'])
    expect(collapseNode(collapseNode(state, 'dv-1'), 'dv-1').expanded.has('dv-1')).toBe(false)
  })

  it('shows empty, truncated, and unavailable notices; unavailable can be retried', () => {
    let state = expandNode(withScopes(), 'dv-1')
    state = applyChildrenResult(state, 'dv-1', { status: 'ok', variables: [], truncated: false })
    expect(describeRows(state)[1]).toBe('  (empty)')

    state = expandNode(withScopes(), 'dv-1')
    state = applyChildrenResult(state, 'dv-1', {
      status: 'ok',
      variables: [variable('a', null)],
      truncated: true
    })
    expect(describeRows(state).slice(1, 3)).toEqual(['  · a', '  (truncated)'])

    state = expandNode(withScopes(), 'dv-1')
    state = applyChildrenResult(state, 'dv-1', { status: 'unavailable', reason: 'stale' })
    expect(describeRows(state)[1]).toBe('  (unavailable:stale)')
    expect(needsChildren(state, 'dv-1')).toBe(true)
  })

  it('ignores a late children response for a node that is no longer loading', () => {
    let state = expandNode(withScopes(), 'dv-1')
    state = applyChildrenResult(state, 'dv-1', {
      status: 'ok',
      variables: [variable('fresh', null)],
      truncated: false
    })

    const late = applyChildrenResult(state, 'dv-1', {
      status: 'ok',
      variables: [variable('late', null)],
      truncated: false
    })

    expect(late).toBe(state)
    expect(
      applyChildrenResult(withScopes(), 'dv-9', { status: 'ok', variables: [], truncated: false })
    ).toEqual(withScopes())
  })

  it('records unavailable scopes', () => {
    const state = applyScopesResult(INITIAL_VARIABLES_TREE, {
      status: 'unavailable',
      reason: 'failed'
    })

    expect(state.scopes).toEqual({ status: 'unavailable', reason: 'failed' })
    expect(flattenVariablesTree(state)).toEqual([])
  })

  it('links every row to its parent for keyboard navigation', () => {
    let state = expandNode(withScopes(), 'dv-1')
    state = applyChildrenResult(state, 'dv-1', {
      status: 'ok',
      variables: [variable('user', 'dv-3')],
      truncated: false
    })

    const rows = flattenVariablesTree(state)

    expect(rows.map((row) => [row.key, row.parentKey])).toEqual([
      ['dv-1', null],
      ['dv-3', 'dv-1'],
      ['dv-2', null],
      ['scope:2', null]
    ])
  })
})

/**
 * Evaluate（Session 6-7）の入口。Scope から始まらないだけで、その下は同じ構造になる。
 */
describe('variables subtree (Session 6-7 evaluate)', () => {
  it('shows nothing until the root is expanded', () => {
    expect(flattenVariablesSubtree(INITIAL_VARIABLES_TREE, 'dv-7', 'evaluate')).toEqual([])
  })

  it('shows loading, then the children, under the evaluate root', () => {
    let state = expandNode(INITIAL_VARIABLES_TREE, 'dv-7')

    expect(flattenVariablesSubtree(state, 'dv-7', 'evaluate')).toEqual([
      {
        kind: 'notice',
        key: 'evaluate#loading',
        depth: 1,
        notice: 'loading',
        reason: null,
        parentKey: 'evaluate'
      }
    ])

    state = applyChildrenResult(state, 'dv-7', {
      status: 'ok',
      variables: [variable('name', null, '"Ada"'), variable('address', 'dv-8')],
      truncated: false
    })

    expect(
      flattenVariablesSubtree(state, 'dv-7', 'evaluate').map((row) => [
        row.key,
        row.depth,
        row.parentKey
      ])
    ).toEqual([
      ['evaluate/0', 1, 'evaluate'],
      ['dv-8', 1, 'evaluate']
    ])
  })

  it('nests deeper levels the same way the scope tree does', () => {
    let state = expandNode(INITIAL_VARIABLES_TREE, 'dv-7')
    state = applyChildrenResult(state, 'dv-7', {
      status: 'ok',
      variables: [variable('address', 'dv-8')],
      truncated: false
    })
    state = expandNode(state, 'dv-8')
    state = applyChildrenResult(state, 'dv-8', {
      status: 'ok',
      variables: [variable('city', null, '"London"')],
      truncated: false
    })

    expect(
      flattenVariablesSubtree(state, 'dv-7', 'evaluate').map((row) => [row.key, row.depth])
    ).toEqual([
      ['dv-8', 1],
      ['dv-8/0', 2]
    ])
  })

  it('carries the same notices as the scope tree', () => {
    let state = expandNode(INITIAL_VARIABLES_TREE, 'dv-7')
    state = applyChildrenResult(state, 'dv-7', { status: 'unavailable', reason: 'stale' })

    expect(flattenVariablesSubtree(state, 'dv-7', 'evaluate')).toEqual([
      {
        kind: 'notice',
        key: 'evaluate#unavailable',
        depth: 1,
        notice: 'unavailable',
        reason: 'stale',
        parentKey: 'evaluate'
      }
    ])
  })

  it('collapses back to nothing', () => {
    let state = expandNode(INITIAL_VARIABLES_TREE, 'dv-7')
    state = applyChildrenResult(state, 'dv-7', {
      status: 'ok',
      variables: [variable('name', null)],
      truncated: false
    })

    expect(flattenVariablesSubtree(collapseNode(state, 'dv-7'), 'dv-7', 'evaluate')).toEqual([])
  })
})
