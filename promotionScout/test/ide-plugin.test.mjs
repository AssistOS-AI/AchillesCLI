import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ScoutToolButton } from '../IDE-plugins/scout-tool-button/scout-tool-button.js';

const pluginFile = name => readFile(new URL(`../IDE-plugins/scout-tool-button/${name}`, import.meta.url), 'utf8');
const expectedModal = { mode: 'iframe', url: '/promotionScout/web/', agentRef: 'AchillesCLI/promotionScout', fullscreen: true };

function fixture() {
  const listeners = new Map();
  const button = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
    setAttribute(name, value) { this[name] = value; },
  };
  const icon = {}, label = {};
  const element = {
    getAttribute: () => '',
    querySelector: selector => ({ '#scoutToolButton': button, '.scout-tool-button-icon-image': icon,
      '.scout-tool-button-label': label })[selector],
  };
  return { listeners, button, icon, label, element };
}

const click = listeners => listeners.get('click')({ preventDefault() {}, stopPropagation() {} });

test('declares an Explorer toolbar plugin that opens the Scout page through the router', async () => {
  const config = JSON.parse(await pluginFile('config.json'));
  assert.equal(config.pluginCategory, 'application');
  assert.equal(config.id, 'promotion-scout');
  assert.equal(config.component, 'scout-tool-button');
  assert.deepEqual(config.location, ['file-exp:toolbar']);
  assert.equal(config.presenter, 'ScoutToolButton');
  assert.deepEqual(config.toolbarModal, expectedModal);
  const [icon, html, css, source] = await Promise.all(['icon.svg', 'scout-tool-button.html', 'scout-tool-button.css',
    'scout-tool-button.js'].map(pluginFile));
  assert.match(icon, /^<svg/);
  assert.match(html, /app-plugin-tool-button/);
  assert.match(html, /app-plugin-tool-icon/);
  assert.match(html, /app-plugin-tool-label/);
  assert.match(css, /data-host-orientation="horizontal"/);
  assert.doesNotMatch(source, /authorization|\/mcp|PLOINKY_/i);
});

test('opens the Scout page in the host expanded modal and follows host metadata', () => {
  const { listeners, button, icon, label, element } = fixture();
  const calls = [];
  const previous = globalThis.assistOS;
  globalThis.assistOS = { UI: { openExpandedModal: options => calls.push(options) } };
  try {
    const presenter = new ScoutToolButton(element, () => {});
    presenter.updateHostContext({ pluginLabel: 'Promotion Scout', pluginTooltip: 'Open Scout',
      pluginIcon: '/workspace-files/scout/icon.svg', pluginToolbarModal: expectedModal });
    presenter.afterRender();
    click(listeners);
    assert.equal(label.textContent, 'Promotion Scout');
    assert.equal(button.title, 'Open Scout');
    assert.equal(button['aria-label'], 'Open Scout');
    assert.equal(icon.src, '/workspace-files/scout/icon.svg');
    assert.deepEqual(calls, [{ ...expectedModal, title: 'Promotion Scout' }]);
    presenter.afterUnload();
    assert.equal(listeners.has('click'), false);
  } finally { globalThis.assistOS = previous; }
});

test('falls back to the Explorer runtime loader when the host modal is unavailable', () => {
  const { listeners, element } = fixture();
  const calls = [];
  const previous = globalThis.window;
  globalThis.window = { open: (...args) => calls.push(args) };
  try {
    const presenter = new ScoutToolButton(element, () => {});
    presenter.afterRender();
    click(listeners);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(1), ['_blank', 'noopener,noreferrer']);
    const url = new URL(calls[0][0], 'https://workspace.test');
    assert.equal(url.pathname, '/explorer/index.html');
    assert.ok(url.hash.startsWith('#agent-runtime-wait?'));
    const parameters = new URLSearchParams(url.hash.split('?')[1]);
    assert.equal(parameters.get('agentRef'), 'AchillesCLI/promotionScout');
    assert.equal(parameters.get('target'), '/promotionScout/web/');
  } finally { globalThis.window = previous; }
});
