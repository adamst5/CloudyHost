// Sample bot that responds to health checks
console.log('Health Check Bot starting...');

// Listen for health check commands on stdin
process.stdin.on('data', (data) => {
  const input = data.toString().trim();
  
  // Respond to health checks
  if (input.startsWith('__HEALTH_CHECK__:')) {
    const healthCheckId = input.replace('__HEALTH_CHECK__:', '');
    console.log(`__HEALTH_CHECK_RESPONSE__:${healthCheckId}`);
    console.log(`[${new Date().toISOString()}] Health check responded: ${healthCheckId}`);
  } else {
    console.log(`[${new Date().toISOString()}] Received: ${input}`);
  }
});

// Simulate some bot activity
let counter = 0;
setInterval(() => {
  counter++;
  console.log(`[${new Date().toISOString()}] Bot heartbeat #${counter}`);
}, 30000); // Log every 30 seconds

console.log('Health Check Bot ready and listening for commands...');