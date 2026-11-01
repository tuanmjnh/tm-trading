import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// =============================================================================
//  Operations UI contract (V4.2 §17.8–§17.9).
//
//  Source-level pins for the rules that a build cannot catch and that would
//  otherwise quietly regress:
//
//    1. the service table is mounted on the EXISTING /operations route (no new
//       Hub route, no seed), and it is the default tab;
//    2. the list provides a mobile layout (AGENTS: every LazyGridList needs
//       `#mobile-content`);
//    3. the detail drawer is lazy (mounts on demand, own chunk);
//    4. an accepted command is NEVER reported as a finished operation — the
//       button polls the operation to a terminal state first.
// =============================================================================

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('operations page wiring', () => {
  test('the service table is the default tab on the existing route', () => {
    const page = read('app/pages/operations.vue')
    assert.match(page, /type ConsoleTab = 'services'/, 'the services tab exists')
    assert.match(page, /const activeTab = ref<ConsoleTab>\('services'\)/, 'it is the default view')
    assert.match(page, /<OperationsServicesPanel \/>/, 'the panel is mounted')
    assert.match(page, /t\('operations\.services\.tab'\)/, 'the tab label is translated')
  })

  test('the panel is a read model with a mobile layout', () => {
    const panel = read('app/components/operations/ServicesPanel.vue')
    assert.match(panel, /<LazyGridList/, 'uses the shared grid list')
    assert.match(panel, /#mobile-content=/, 'provides the mobile card slot')
    assert.match(panel, /api\.view\(\)/, 'reads the operations view')
    assert.match(panel, /@click="openDetail"/, 'a row click opens the drawer, it never mutates')
    assert.match(panel, /<LazyOperationsServiceDetailDrawer/, 'the detail drawer is lazy')
    assert.match(panel, /operations\.services\.columns\.slo/, 'the table carries an SLO column')
    assert.match(panel, /operations\.services\.summary\.sloBreached/, 'the header rolls the breached count up')
    assert.match(panel, /operations\.services\.summary\.deadLetter/, 'the header rolls up the dead-letter count')
    assert.match(panel, /OperationsServiceSloBadge/, 'the verdict is rendered from the shared badge')
  })

  test('the list supports list and grid view, persisted per user', () => {
    const panel = read('app/components/operations/ServicesPanel.vue')
    assert.match(panel, /useAdminGridView\('operations-services-view-mode'\)/, 'view mode is remembered')
    assert.match(panel, /v-model:view-mode="viewMode"/, 'bound to the grid list')
    assert.match(panel, /storage-key="operations-services-view-mode"/)
    assert.match(panel, /<AdminViewModeToggle/, 'the user can switch')
    assert.match(panel, /grid-cols="/, 'grid mode defines its columns')
  })

  test('the list has a bounded height with its own scroll area', () => {
    const panel = read('app/components/operations/ServicesPanel.vue')
    assert.match(panel, /:ui-scroll-area="\{ root: 'max-h-\[/)
    assert.match(panel, /max-h-\[min\(62vh,700px\)\]/)
  })

  test('the context menu is grouped and colour-coded, with mobile shortcuts', () => {
    const panel = read('app/components/operations/ServicesPanel.vue')
    assert.match(panel, /:action-options="getActionOptions"/, 'long-press / ⋯ menu')
    assert.match(panel, /type: 'label'/, 'menu groups carry a label')
    assert.match(panel, /operations\.services\.menu\.control/, 'a Lifecycle group')
    assert.match(panel, /operations\.services\.menu\.inspect/, 'an Inspect group')
    assert.match(panel, /color: entry\.color/, 'items keep their severity colour')
    assert.match(panel, /isActionDisabled\(item, entry\.action\)/, 'disabled state is decided in one place')
    assert.match(panel, /:swipe-right-actions="swipeActions"/, 'mobile swipe shortcuts')
  })

  test('rows can be dragged to reorder, and the order is remembered', () => {
    const panel = read('app/components/operations/ServicesPanel.vue')
    assert.match(panel, /useStorage<string\[]>\('operations-services-order'/, 'per-user order')
    assert.match(panel, /:draggable="canDrag"/, 'drag is offered')
    assert.match(panel, /canDrag = computed\(\(\) => search\.value\.trim\(\)\.length === 0 && stateFilter\.value === 'all'\)/,
      'reordering only makes sense on the complete list')
    assert.match(panel, /@update:items="onReorder"/)
    assert.match(panel, /order\.value = items\.map\(item => item\.serviceId\)/, 'the new order is persisted')
  })

  test('the detail drawer is lazy and renders the proof the supervisor collects', () => {
    const drawer = read('app/components/operations/ServiceDetailDrawer.vue')
    assert.match(drawer, /<LazyBaseResponsiveSlideover/, 'a lazy slideover, not a modal')
    assert.match(drawer, /operations\.services\.detail\.readiness/, 'shows readiness checks')
    assert.match(drawer, /operations\.services\.detail\.telemetry/, 'shows the A7 telemetry sample')
    assert.match(drawer, /operations\.services\.detail\.controlPlane/, 'shows control-plane latency')
    assert.match(drawer, /OperationsServiceSloBadge/, 'shows the SLO verdict and its objectives')
    assert.match(drawer, /OperationsServiceActionButton/, 'actions are reachable from the drawer')
  })

  test('an accepted command is never rendered as a result', () => {
    const button = read('app/components/operations/ServiceActionButton.vue')
    assert.match(button, /api\.command\(/, 'enqueues the command')
    assert.match(button, /api\.operation\(/, 'polls the operation it just created')
    assert.match(button, /runServiceOperation\(/, 'the follow-to-terminal loop is shared, not reimplemented')
    assert.match(button, /result\.accepted/, 'acceptance is announced as accepted, not as success')
    assert.match(button, /result\.unconfirmed/, 'UNCONFIRMED is surfaced as "check by hand"')
    assert.doesNotMatch(button, /setInterval/, 'no timer to leak: the loop lives in the util')

    const util = read('app/utils/serviceOperation.ts')
    assert.match(util, /isTerminalState\(snapshot\.state\)/, 'only a terminal state ends the wait')
    assert.match(util, /state: 'UNCONFIRMED'/, 'a deadline ends unconfirmed, never as success')
  })
})
