import { ContributorProfile } from './types.js';
import { NEAR_CONFIG } from './config.js';

/**
 * NEAR Social (SocialDB) Integration
 * Generates, queries, and broadcasts on-chain reputation badges to near.social (v1.social08.testnet)
 * conforming to official SocialDB specifications.
 */
export class NearSocialConnector {
  private networkId: string;
  private socialContractId: string;
  private nodeUrl: string;

  constructor(
    networkId: string = NEAR_CONFIG.networkId,
    nodeUrl: string = NEAR_CONFIG.nodeUrl
  ) {
    this.networkId = networkId;
    this.socialContractId = networkId === 'mainnet' ? 'social.near' : 'v1.social08.testnet';
    this.nodeUrl = nodeUrl;
  }

  /**
   * Generates a SocialDB `set` payload for writing a Trust Badge to a contributor's profile.
   * Format conforms to standard NEP-BOS profile badges:
   * { [account_id]: { profile: { badges: { "pact": "..." } } } }
   */
  public generateBadgePayload(profile: ContributorProfile): {
    contractId: string;
    methodName: string;
    args: Record<string, any>;
    depositYocto: string;
    gas: string;
  } {
    const badgeName = profile.current_tier === 'TRUSTED_CORE'
      ? 'Pact Core Contributor (Tier 1)'
      : 'Pact Verified Contributor (Tier 2)';

    const badgeData = {
      title: badgeName,
      trustScore: profile.trust_score,
      completedBounties: profile.completed_bounties_count,
      awardedAt: new Date().toISOString(),
      protocol: 'Pact'
    };

    const dataPayload = {
      [profile.account_id]: {
        profile: {
          badges: {
            pact: JSON.stringify(badgeData)
          }
        },
        index: {
          notify: JSON.stringify({
            key: profile.account_id,
            value: {
              type: 'trust_badge_awarded',
              message: `Congratulations! You unlocked ${badgeName} with a Trust Score of ${profile.trust_score}.`
            }
          })
        }
      }
    };

    return {
      contractId: this.socialContractId,
      methodName: 'set',
      args: { data: dataPayload },
      depositYocto: '50000000000000000000000', // 0.05 NEAR storage deposit for SocialDB
      gas: '100000000000000' // 100 TGas
    };
  }

  /**
   * Fetches an account's live on-chain profile and badge records from SocialDB (v1.social08.testnet)
   */
  public async fetchSocialProfile(accountId: string): Promise<any> {
    const argsBase64 = Buffer.from(JSON.stringify({
      keys: [`${accountId}/profile/**`]
    })).toString('base64');

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: `pactt-social-${Date.now()}`,
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: this.socialContractId,
        method_name: 'get',
        args_base64: argsBase64
      }
    });

    try {
      const response = await fetch(this.nodeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });

      if (!response.ok) return null;
      const json = await response.json() as any;

      if (json.result && json.result.result) {
        const raw = Buffer.from(json.result.result).toString('utf8');
        return JSON.parse(raw);
      }
      return null;
    } catch (err: any) {
      console.warn(`[NearSocialConnector] Error querying SocialDB: ${err.message}`);
      return null;
    }
  }

  /**
   * Helper to verify transaction status on SocialDB API / Explorer
   */
  public getVerificationUrl(txHash: string): string {
    return `https://testnet.nearblocks.io/txns/${txHash}`;
  }

  public getContractId(): string {
    return this.socialContractId;
  }
}
