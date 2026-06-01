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
  "bms-core-service": { buildPipelineId: 132, releasePipelineId: 162 },
  "bms-order-service": { buildPipelineId: 143, releasePipelineId: 171 },
  "bms-payment-service": { buildPipelineId: 144, releasePipelineId: 172 },
  "bms-inventory-service": { buildPipelineId: 137, releasePipelineId: 167 },
  "bms-item-service": { buildPipelineId: 126, releasePipelineId: 168 },
  "bms-pricing-service": { buildPipelineId: 145, releasePipelineId: 173 },
  "bms-search-service": { buildPipelineId: 147, releasePipelineId: 175 },
  "bms-message-service": { buildPipelineId: 141, releasePipelineId: 170 },
  "bms-cache-service": { buildPipelineId: 133, releasePipelineId: 160 },
  "bms-geo-service": { buildPipelineId: 125, releasePipelineId: 165 },
  "bms-coupon-service": { buildPipelineId: 134, releasePipelineId: 163 },
  "bms-file-upload-service": { buildPipelineId: 135, releasePipelineId: 164 },
  "websocket-service": { buildPipelineId: 148, releasePipelineId: 190 },
  "bms-web": { buildPipelineId: 127, releasePipelineId: 177 },
  "bms-sales-admin": { buildPipelineId: 128, releasePipelineId: 174 },
  "sso": { buildPipelineId: 129, releasePipelineId: 176 },
  "bms-hm-queue": { buildPipelineId: 155, releasePipelineId: 166 },
  "backend-cron-jobs": { buildPipelineId: 142, releasePipelineId: 158 },
  "bms-clustering-service": { buildPipelineId: 124, releasePipelineId: 161 },
  "bms-lm-queue": { buildPipelineId: 154, releasePipelineId: 156 },
  "ml-service": { buildPipelineId: 151, releasePipelineId: 183 },
  "ops-tracker-service": { buildPipelineId: 217, releasePipelineId: 218 },
  "vibe-coding": { buildPipelineId: 219, releasePipelineId: 220 },
  "qwipo-website-admin": { buildPipelineId: 130, releasePipelineId: 186 },
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
  "ondc-message-processor": { buildPipelineId: 213, releasePipelineId: 214 },

  // docker-cd-seller-* / argocd-seller-* and marketplace-connector pipelines
  "seller-portal": { buildPipelineId: 229, releasePipelineId: 235 },
  "seller-core-service-api": { buildPipelineId: 222, releasePipelineId: 223 },
  "seller-core-service-scheduler": { buildPipelineId: 224, releasePipelineId: 230 },
  "seller-core-service-subscriber": { buildPipelineId: 225, releasePipelineId: 231 },
  "marketplace-connector-api": { buildPipelineId: 226, releasePipelineId: 232 },
  "marketplace-connector-scheduler": { buildPipelineId: 227, releasePipelineId: 233 },
  "marketplace-connector-subscriber": { buildPipelineId: 228, releasePipelineId: 234 },
};

module.exports = { SERVICE_ALIASES };
