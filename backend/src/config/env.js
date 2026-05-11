const required = ['DATABASE_URL', 'JWT_SECRET'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  apiPrefix: process.env.API_PREFIX ?? '/api',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtIssuer: process.env.JWT_ISSUER ?? 'aetnix-platform',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '8h',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 7),
  platformName: process.env.PLATFORM_NAME ?? 'AETNIX',
  monitoringOfflineThresholdMs: Number(process.env.MONITORING_OFFLINE_THRESHOLD_MS ?? 120000),
  monitoringSweepIntervalMs: Number(process.env.MONITORING_SWEEP_INTERVAL_MS ?? 60000),
  monitoringCpuWarningPercent: Number(process.env.MONITORING_CPU_WARNING_PERCENT ?? 85),
  monitoringCpuCriticalPercent: Number(process.env.MONITORING_CPU_CRITICAL_PERCENT ?? 95),
  monitoringMemoryWarningPercent: Number(process.env.MONITORING_MEMORY_WARNING_PERCENT ?? 85),
  monitoringMemoryCriticalPercent: Number(process.env.MONITORING_MEMORY_CRITICAL_PERCENT ?? 95),
  monitoringDiskWarningPercent: Number(process.env.MONITORING_DISK_WARNING_PERCENT ?? 85),
  monitoringDiskCriticalPercent: Number(process.env.MONITORING_DISK_CRITICAL_PERCENT ?? 95),
};
