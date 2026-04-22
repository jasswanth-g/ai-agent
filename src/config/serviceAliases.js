/**
 * Service alias mapping.
 *
 * Maps friendly service names to their Azure DevOps pipeline IDs.
 * Add your commonly used services here for instant lookup.
 *
 * Format:
 *   "friendly-name": { buildPipelineId: <number>, releasePipelineId: <number> }
 */
const SERVICE_ALIASES = {
  // docker-cd-* build pipelines
  "core-service": { buildPipelineId: 132, releasePipelineId: 162 },
  "order-service": { buildPipelineId: 143, releasePipelineId: 171 },
  "payment-service": { buildPipelineId: 144, releasePipelineId: 172 },
  "inventory-service": { buildPipelineId: 137, releasePipelineId: 167 },
  "item-service": { buildPipelineId: 126, releasePipelineId: 168 },
  "pricing-service": { buildPipelineId: 145, releasePipelineId: 173 },
  "search-service": { buildPipelineId: 147, releasePipelineId: 175 },
  "message-service": { buildPipelineId: 141, releasePipelineId: 170 },
  "cache-service": { buildPipelineId: 133, releasePipelineId: 160 },
  "geo-service": { buildPipelineId: 125, releasePipelineId: 165 },
  "coupon-service": { buildPipelineId: 134, releasePipelineId: 163 },
  "file-upload-service": { buildPipelineId: 135, releasePipelineId: 164 },
  "websocket-service": { buildPipelineId: 148, releasePipelineId: 190 },
  "bms-web": { buildPipelineId: 127, releasePipelineId: 177 },
  "sales-admin": { buildPipelineId: 128, releasePipelineId: 174 },
  "sso": { buildPipelineId: 129, releasePipelineId: 176 },
  "hm-queue": { buildPipelineId: 155, releasePipelineId: 166 },
  "cron-jobs": { buildPipelineId: 142, releasePipelineId: 158 },
  "clustering-service": { buildPipelineId: 124, releasePipelineId: 161 },
  "lm-queue": { buildPipelineId: 154, releasePipelineId: 156 },
  "ml-service": { buildPipelineId: 151, releasePipelineId: 183 },
  "ops-tracker-service": { buildPipelineId: 217, releasePipelineId: 218 },
  "vibe-coding": { buildPipelineId: 219, releasePipelineId: 220 },
  "qwipo-web-admin": { buildPipelineId: 130, releasePipelineId: 186 },
  "qwipo-web-new": { buildPipelineId: 131, releasePipelineId: 188 },
  "qwipo-website-api": { buildPipelineId: 150, releasePipelineId: 187 },
  "pre-order-service": { buildPipelineId: 215, releasePipelineId: 216 },

  // docker-cd-monorepo-* build pipelines / argocd-monorepo-* release pipelines
  "partner-portal": { buildPipelineId: 192, releasePipelineId: 193 },
  "partner-service": { buildPipelineId: 211, releasePipelineId: 212 },
  "ondc-gateway": { buildPipelineId: 205, releasePipelineId: 206 },
  "auth-service": { buildPipelineId: 201, releasePipelineId: 202 },
  "retail-buyer-service": { buildPipelineId: 194, releasePipelineId: 196 },
  "retail-seller-service": { buildPipelineId: 195, releasePipelineId: 197 },
  "logistics-buyer-service": { buildPipelineId: 199, releasePipelineId: 200 },
  "logistics-seller-service": { buildPipelineId: 203, releasePipelineId: 204 },
  "logistics-buyer-web": { buildPipelineId: 207, releasePipelineId: 208 },
  "logistics-seller-web": { buildPipelineId: 209, releasePipelineId: 210 },
  "ondc-mq": { buildPipelineId: 213, releasePipelineId: 214 },

  // Team-name aliases — same pipeline IDs as the canonical entries above.
  "ondc-message-processor": { buildPipelineId: 213, releasePipelineId: 214 }, // same as ondc-mq
  "bms-search-service": { buildPipelineId: 147, releasePipelineId: 175 },     // same as search-service
  "bms-order-service": { buildPipelineId: 143, releasePipelineId: 171 },      // same as order-service
};

module.exports = { SERVICE_ALIASES };
