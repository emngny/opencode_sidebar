// Integration test through the extension's OWN code path:
// ChatCoordinator -> OpencodeCli -> live opencode server.
// Captures the exact messages the webview receives, so a blank assistant
// bubble is reproducible here instead of only in the sidebar UI.
import { ChatCoordinator } from '../out/extension/services/ChatCoordinator.js';
import { OpencodeCli } from '../out/extension/services/OpencodeCli.js';
import { SessionService } from '../out/extension/services/SessionService.js';

const cli = new OpencodeCli(process.cwd());
const sessions = new SessionService(cli);
const received = [];

const coordinator = new ChatCoordinator(cli, sessions, (message) => {
  received.push(message);
  if (message.type === 'receiveMessage') {
    console.log(`[ui] receiveMessage role=${message.payload.role} content=${JSON.stringify(message.payload.content)}`);
  } else if (message.type === 'receiveChunk') {
    console.log(`[ui] receiveChunk content=${JSON.stringify(message.payload.content)}`);
  } else if (message.type === 'streamEnd') {
    console.log(`[ui] streamEnd contentLen=${message.payload.content?.length ?? 0}`);
  } else if (message.type === 'error') {
    console.log(`[ui] error ${message.payload.message}`);
  } else {
    console.log(`[ui] ${message.type}`);
  }
});

await cli.start();
const providers = await cli.listProviders();
const connected = new Set(providers.connected || []);
const catalog = [];
for (const provider of providers.all || []) {
  if (!connected.has(provider.id)) continue;
  for (const modelId of Object.keys(provider.models || {})) catalog.push(`${provider.id}/${modelId}`);
}
const model = catalog.find((id) => id.startsWith('opencode/')) ?? catalog[0];
const session = await cli.createSession('integration test');
sessions.currentSessionId = session.id;

const stored = sessions.currentSessionId;
console.log('[test] model:', model, '| session:', stored);

await coordinator.processPrompt('Reply with exactly: merhaba', 'build', undefined, model);

const assistantBubbles = received
  .filter((m) => m.type === 'receiveMessage' && m.payload.role === 'assistant')
  .map((m) => m.payload.content);
const chunks = received
  .filter((m) => m.type === 'receiveChunk')
  .map((m) => m.payload.content)
  .join('');
const errors = received.filter((m) => m.type === 'error').map((m) => m.payload.message);

console.log('');
console.log('[test] assistant bubbles started:', assistantBubbles.length);
console.log('[test] streamed chars:', chunks.length);
console.log('[test] errors:', errors.length ? errors : 'none');
console.log('[test] VERDICT:', chunks.length > 0 && errors.length === 0 ? 'ASSISTANT TEXT RENDERED' : 'STILL BLANK');

cli.stop();
process.exit(0);
