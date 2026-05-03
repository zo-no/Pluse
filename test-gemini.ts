import { listRuntimeTools, getRuntimeModelCatalog } from './packages/server/src/runtime/catalog'

console.log('--- Testing listRuntimeTools ---')
const tools = listRuntimeTools()
console.log('Tools returned:', JSON.stringify(tools, null, 2))

const geminiAvailable = tools.some(t => t.id === 'gemini')
console.log('Gemini available:', geminiAvailable)

console.log('\n--- Testing getRuntimeModelCatalog(gemini) ---')
const catalog = getRuntimeModelCatalog('gemini')
console.log('Gemini Catalog:', JSON.stringify(catalog, null, 2))

if (geminiAvailable && catalog.models.length > 0) {
  console.log('\n✅ Gemini Backend Integration Verified!')
} else {
  console.log('\n❌ Gemini Backend Integration Failed!')
  process.exit(1)
}
