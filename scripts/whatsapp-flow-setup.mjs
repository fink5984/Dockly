/**
 * One-time setup of the WhatsApp document-upload Flow (see server/messaging/whatsappFlow.mjs).
 * Reads WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_ID / WHATSAPP_BUSINESS_ACCOUNT_ID from .env.
 * Keys and generated files go to .wa-flow/ (git-ignored). Never prints secrets.
 *
 *   node scripts/whatsapp-flow-setup.mjs keys                       generate the RSA key pair
 *   node scripts/whatsapp-flow-setup.mjs upload-key                 register the public key with Meta
 *   node scripts/whatsapp-flow-setup.mjs create --base https://sadir.app   create the Flow + upload its JSON
 *   node scripts/whatsapp-flow-setup.mjs update  [flowId]           re-upload the Flow JSON after changes
 *   node scripts/whatsapp-flow-setup.mjs status  [flowId]           status, validation errors, health
 *   node scripts/whatsapp-flow-setup.mjs publish [flowId]           publish (irreversible for that version)
 *   node scripts/whatsapp-flow-setup.mjs template [flowId]          submit the request template for approval
 *
 * flowId defaults to WHATSAPP_FLOW_ID.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { generateKeyPairSync } from 'crypto'
import { join } from 'path'
import dotenv from 'dotenv'
import { documentsFlow } from '../server/messaging/documentsFlow.mjs'

dotenv.config({ quiet: true })
const env = process.env
const DIR = '.wa-flow'
const GRAPH = env.WHATSAPP_GRAPH_API || 'https://graph.facebook.com/v25.0'
const FLOW_NAME = 'sadir_documents'
const TEMPLATE_NAME = 'sadir_document_request_flow'

const [cmd, ...rest] = process.argv.slice(2)
const arg = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined }
const positional = rest.find((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'))
const flowId = () => positional || env.WHATSAPP_FLOW_ID || fail('Pass a flow id or set WHATSAPP_FLOW_ID')

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1) }
function need(name) { return env[name] || fail(`${name} is missing in .env`) }

/** curl keeps working behind TLS-inspecting antivirus where Node's fetch doesn't. */
function graph(method, path, { json, form = [] } = {}) {
  const args = ['-sS', '--ssl-no-revoke', '-X', method, '-H', `Authorization: Bearer ${need('WHATSAPP_ACCESS_TOKEN')}`]
  if (json) args.push('-H', 'Content-Type: application/json', '--data-binary', '@-')
  for (const f of form) args.push(f.startsWith('@') ? '--data-urlencode' : '-F', f.startsWith('@') ? f.slice(1) : f)
  args.push(`${GRAPH}/${path}`)
  const out = execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { input: json ? JSON.stringify(json) : undefined, encoding: 'utf8' })
  const data = JSON.parse(out || '{}')
  if (data.error) fail(`${data.error.message} (code ${data.error.code})`)
  return data
}

function writeFlowJson() {
  mkdirSync(DIR, { recursive: true })
  const file = join(DIR, 'flow.json')
  writeFileSync(file, JSON.stringify(documentsFlow, null, 2))
  return file
}

function uploadAsset(id) {
  const res = graph('POST', `${id}/assets`, { form: [`file=@${writeFlowJson()};type=application/json`, 'name=flow.json', 'asset_type=FLOW_JSON'] })
  if (res.validation_errors?.length) {
    console.log('⚠ Flow JSON validation errors:')
    for (const e of res.validation_errors) console.log(`  - ${e.error}: ${e.message}${e.pointers ? ` ${JSON.stringify(e.pointers)}` : ''}`)
  } else {
    console.log('✔ Flow JSON uploaded, no validation errors')
  }
}

switch (cmd) {
  case 'keys': {
    const priv = join(DIR, 'private.pem')
    if (existsSync(priv)) fail(`${priv} already exists; delete it first to rotate (then run upload-key again)`)
    mkdirSync(DIR, { recursive: true })
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    writeFileSync(priv, privateKey, { mode: 0o600 })
    writeFileSync(join(DIR, 'public.pem'), publicKey)
    writeFileSync(join(DIR, 'WHATSAPP_FLOW_PRIVATE_KEY.txt'), Buffer.from(privateKey).toString('base64'), { mode: 0o600 })
    console.log(`✔ Keys written to ${DIR}/`)
    console.log(`  Put the contents of ${DIR}/WHATSAPP_FLOW_PRIVATE_KEY.txt in Railway as WHATSAPP_FLOW_PRIVATE_KEY`)
    break
  }
  case 'upload-key': {
    const pub = readFileSync(join(DIR, 'public.pem'), 'utf8')
    graph('POST', `${need('WHATSAPP_PHONE_ID')}/whatsapp_business_encryption`, { form: [`@business_public_key=${pub}`] })
    const check = graph('GET', `${need('WHATSAPP_PHONE_ID')}/whatsapp_business_encryption`)
    console.log(`✔ Public key registered (signature: ${check.data?.[0]?.business_public_key_signature_status || 'unknown'})`)
    break
  }
  case 'create': {
    const base = (arg('base') || env.APP_BASE_URL || fail('Pass --base https://your-domain')).replace(/\/+$/, '')
    const created = graph('POST', `${need('WHATSAPP_BUSINESS_ACCOUNT_ID')}/flows`, {
      json: { name: FLOW_NAME, categories: ['OTHER'], endpoint_uri: `${base}/api/whatsapp/webhook/flow` },
    })
    console.log(`✔ Flow created: ${created.id}  →  set WHATSAPP_FLOW_ID=${created.id} in Railway`)
    uploadAsset(created.id)
    break
  }
  case 'update':
    uploadAsset(flowId())
    break
  case 'status': {
    const s = graph('GET', `${flowId()}?fields=id,name,status,validation_errors,endpoint_uri,health_status`)
    console.log(JSON.stringify(s, null, 2))
    break
  }
  case 'publish':
    graph('POST', `${flowId()}/publish`)
    console.log('✔ Flow published')
    break
  case 'template': {
    const res = graph('POST', `${need('WHATSAPP_BUSINESS_ACCOUNT_ID')}/message_templates`, {
      json: {
        name: TEMPLATE_NAME,
        language: env.WA_TEMPLATE_FLOW_LANG || 'he',
        category: 'UTILITY',
        components: [
          {
            type: 'BODY',
            text: 'שלום {{1}},\nבבקשה "{{3}}" חסרים עוד {{2}} מסמכים.\nבלחיצה על הכפתור ייפתח טופס מאובטח שבו אפשר לצלם או לצרף כל מסמך.',
            example: { body_text: [['דנה', '3', 'בקשת משכנתא']] },
          },
          { type: 'BUTTONS', buttons: [{ type: 'FLOW', text: 'העלאת מסמכים', flow_id: flowId(), flow_action: 'data_exchange' }] },
        ],
      },
    })
    console.log(`✔ Template submitted: ${TEMPLATE_NAME} (status: ${res.status})`)
    console.log(`  Once APPROVED, set WA_TEMPLATE_DOCUMENT_REQUEST_FLOW=${TEMPLATE_NAME} in Railway`)
    break
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0])
}
