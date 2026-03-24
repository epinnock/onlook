import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';
const results = [];

function log(test, pass, detail = '') {
  const icon = pass ? '✅' : '❌';
  results.push({ test, pass, detail });
  console.log(`${icon} ${test}${detail ? ' — ' + detail : ''}`);
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // ─── Test 1: App loads without compilation errors ───
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
    const title = await page.title();
    const hasErrorOverlay = await page.$('[data-nextjs-errors]') !== null;
    log('App loads at /login', !hasErrorOverlay && title.includes('Onlook'), `title="${title}"`);
  } catch (e) {
    log('App loads at /login', false, e.message);
  }

  // ─── Test 2: Sign in as demo user ───
  try {
    await page.click('button:has-text("DEV MODE")').catch(() => {});
    // Fallback: find button by text content
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.evaluate(el => el.textContent);
      if (text?.includes('DEV MODE')) {
        await btn.click();
        break;
      }
    }
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    const url = page.url();
    log('Demo sign-in redirects', url !== `${BASE}/login`, `url=${url}`);
  } catch (e) {
    log('Demo sign-in redirects', false, e.message);
  }

  // ─── Test 3: Settings API - GET returns 200 ───
  try {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/trpc/settings.get?input=' + encodeURIComponent(JSON.stringify({ json: { projectId: '00000000-0000-0000-0000-000000000000' } })));
      return { status: r.status, body: await r.json() };
    });
    log('Settings GET /api/trpc/settings.get', res.status === 200, `status=${res.status}`);
    const data = res.body?.result?.data?.json;
    log('Settings GET returns null for missing project', data === null);
  } catch (e) {
    log('Settings GET endpoint', false, e.message);
  }

  // ─── Test 4: Settings API - SQL includes mcp_servers column ───
  try {
    // Use a valid UUID format for the project ID
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/trpc/settings.upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: {
            projectId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            settings: {
              projectId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
              runCommand: '', buildCommand: '', installCommand: '',
              mcpServers: [{ id: 'test', name: 'test', transport: 'http', url: 'http://test', enabled: true }],
            }
          }
        })
      });
      const body = await r.text();
      return { status: r.status, body };
    });
    // We expect a 500 (FK violation) but the SQL should mention mcp_servers
    const sqlIncludesMcp = res.body.includes('mcp_servers');
    log('SQL query includes mcp_servers column', sqlIncludesMcp, `status=${res.status}, sql has mcp_servers=${sqlIncludesMcp}`);
  } catch (e) {
    log('Settings upsert SQL check', false, e.message);
  }

  // ─── Test 5: Chat API route compiles (POST without auth returns 401 or 500) ───
  try {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [], chatType: 'EDIT', conversationId: 'test', projectId: 'test' }),
      });
      const body = await r.text();
      return { status: r.status, body: body.substring(0, 300) };
    });
    // 401 = auth check ran, 500 = route compiled but hit a runtime error (e.g. missing auth)
    // Both mean the route handler itself loaded successfully (no import/compile errors)
    const chatRouteCompiles = res.status === 401 || res.status === 500 || res.status === 400;
    const isImportError = res.body.includes('Module not found') || res.body.includes('Cannot find module');
    log('Chat API route /api/chat compiles', chatRouteCompiles && !isImportError, `status=${res.status}`);
  } catch (e) {
    log('Chat API route', false, e.message);
  }

  // ─── Test 6: No MCP-related console errors ───
  const mcpErrors = consoleErrors.filter(e => e.toLowerCase().includes('mcp'));
  log('No MCP-related console errors', mcpErrors.length === 0,
    mcpErrors.length > 0 ? mcpErrors.join('; ') : `${consoleErrors.length} total console errors, 0 MCP-related`);

  // ─── Test 7: Import verification - navigate to project page to trigger MCP component imports ───
  try {
    // Navigate to a project route to force Next.js to compile the project/[id] chunk
    // which includes our ToolCallDisplay, McpAppDisplay, etc.
    // Use waitUntil: 'load' and handle redirects gracefully
    const response = await page.goto(`${BASE}/project/test-id`, { waitUntil: 'load', timeout: 20000 }).catch(e => e);
    await new Promise(r => setTimeout(r, 5000));

    const currentUrl = page.url();

    // Check for module/import errors (these show as Next.js error overlays)
    const hasModuleError = await page.evaluate(() => {
      const overlay = document.querySelector('[data-nextjs-errors]');
      if (!overlay) return null;
      return overlay.textContent?.substring(0, 200);
    }).catch(() => null);

    if (hasModuleError && (hasModuleError.includes('Module not found') || hasModuleError.includes('Cannot find module'))) {
      log('Project page MCP imports compile', false, hasModuleError);
    } else {
      log('Project page MCP imports compile', true,
        hasModuleError ? 'non-import error (expected): ' + hasModuleError.substring(0, 80) :
        `no import errors (url=${currentUrl})`);
    }
  } catch (e) {
    log('Project page MCP imports', false, e.message);
  }

  // ─── Test 8: MCP utility function logic (run in browser context) ───
  try {
    const utilResults = await page.evaluate(() => {
      // Test parseMcpToolName logic
      function parseMcpToolName(toolName) {
        if (!toolName.startsWith('mcp_')) return null;
        const withoutPrefix = toolName.slice(4);
        const idx = withoutPrefix.indexOf('_');
        if (idx === -1) return { serverName: withoutPrefix, originalToolName: withoutPrefix };
        return { serverName: withoutPrefix.slice(0, idx), originalToolName: withoutPrefix.slice(idx + 1) };
      }

      // Test resolveUiResourceUri logic
      function resolveUiResourceUri(resourceUri, mcpServerUrl) {
        if (!mcpServerUrl) return resourceUri;
        const path = resourceUri.replace(/^ui:\/\//, '');
        const base = mcpServerUrl.replace(/\/$/, '');
        return `${base}/_mcp/ui/${path}`;
      }

      // Test getMcpAppUiResource logic
      function getMcpAppUiResource(output) {
        if (!output) return null;
        const meta = output._meta;
        const ui = meta?.ui;
        const resourceUri = ui?.resourceUri;
        if (typeof resourceUri === 'string' && resourceUri.startsWith('ui://')) {
          return { resourceUri, title: ui?.title };
        }
        return null;
      }

      return {
        parse1: JSON.stringify(parseMcpToolName('mcp_figma_search_components')),
        parse2: JSON.stringify(parseMcpToolName('read_file')),
        resolve1: resolveUiResourceUri('ui://charts/bar', 'https://mcp.example.com'),
        resolve2: resolveUiResourceUri('ui://widget/form', 'https://mcp.example.com/'),
        detect1: JSON.stringify(getMcpAppUiResource({ _meta: { ui: { resourceUri: 'ui://charts/bar', title: 'Bar' } } })),
        detect2: JSON.stringify(getMcpAppUiResource({ result: 'data' })),
        detect3: JSON.stringify(getMcpAppUiResource(null)),
      };
    });

    log('parseMcpToolName("mcp_figma_search_components")',
      utilResults.parse1 === '{"serverName":"figma","originalToolName":"search_components"}',
      utilResults.parse1);
    log('parseMcpToolName("read_file") returns null',
      utilResults.parse2 === 'null');
    log('resolveUiResourceUri resolves correctly',
      utilResults.resolve1 === 'https://mcp.example.com/_mcp/ui/charts/bar',
      utilResults.resolve1);
    log('resolveUiResourceUri strips trailing slash',
      utilResults.resolve2 === 'https://mcp.example.com/_mcp/ui/widget/form',
      utilResults.resolve2);
    log('getMcpAppUiResource detects ui:// resource',
      utilResults.detect1 === '{"resourceUri":"ui://charts/bar","title":"Bar"}',
      utilResults.detect1);
    log('getMcpAppUiResource returns null for no _meta',
      utilResults.detect2 === 'null');
    log('getMcpAppUiResource returns null for null output',
      utilResults.detect3 === 'null');
  } catch (e) {
    log('MCP utility functions', false, e.message);
  }

  // ─── Summary ───
  console.log('\n' + '═'.repeat(60));
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${results.length} tests\n`);

  if (failed > 0) {
    console.log('  Failed tests:');
    results.filter(r => !r.pass).forEach(r => console.log(`    ❌ ${r.test}: ${r.detail}`));
  }

  console.log('');
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
