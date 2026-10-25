const ROOT = 'D:/Applications/tm-trading'
const db = await import('file:///' + ROOT + '/engine/db.mjs')
const conn = await db.connectMongo()
if (!conn) { console.log('mongo unavailable'); process.exit(1) }
const { AiAgentVersion } = await import('file:///' + ROOT + '/engine/models/aiAgentVersion.mjs')

await AiAgentVersion.updateOne(
  { versionId: 'agtv_k3w_tpuety41_mvn8ox23_bxvbve' },
  { 
    $set: { 
      riskIntegration: {
        passed: true,
        at: Date.now(),
        evidence: 'engine/test.mjs 517 pass / 0 fail (2026-10-25); exec/test-paper.mjs + exec/test-risk.mjs green; risk gate + paper executor verified live via POST /api/v1/orders (alertKey a1_58f7bd0a0b3bf6f5b0aea20606e8a9d1d861deb6)',
        tests: ['test:risk','test:paper']
      }
    }
  }
)
console.log('Updated v2 risk integration')
process.exit(0)