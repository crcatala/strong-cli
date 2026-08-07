const required = ['STRONG_USERNAME', 'STRONG_PASSWORD']
const missing = required.filter((name) => !process.env[name])

if (process.env.RUN_LIVE_TESTS !== '1' || missing.length > 0) {
  console.error('Live tests are opt-in and require a dedicated test account.')
  console.error(`Set RUN_LIVE_TESTS=1 and ${required.join(', ')}.`)
  process.exit(1)
}
