import { SputnikProposalArgs } from './types.js';
import { NEAR_CONFIG } from './config.js';

export interface SputnikProposalPayload {
  proposal: {
    description: string;
    kind: {
      Transfer: {
        token_id: string; // "" represents native NEAR
        receiver_id: string;
        amount: string;   // yoctoNEAR
      };
    };
  };
}

export interface SputnikDaoPolicy {
  proposal_bond: string;
  proposal_period: string;
  bounty_bond?: string;
  bounty_forgiveness_period?: string;
  roles: Array<{
    name: string;
    kind: any;
    permissions: string[];
    vote_policy: Record<string, any>;
  }>;
}

export class SputnikConnector {
  private daoContractId: string;
  private nodeUrl: string;

  constructor(
    daoContractId: string = NEAR_CONFIG.sputnikDaoContract,
    nodeUrl: string = NEAR_CONFIG.nodeUrl
  ) {
    this.daoContractId = daoContractId;
    this.nodeUrl = nodeUrl;
  }

  /**
   * Raw JSON-RPC View Function Caller
   */
  private async callRpcView(methodName: string, args: Record<string, any> = {}): Promise<any> {
    const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64');
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: `pactt-sputnik-${Date.now()}`,
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: this.daoContractId,
        method_name: methodName,
        args_base64: argsBase64
      }
    });

    try {
      const response = await fetch(this.nodeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });

      if (!response.ok) {
        throw new Error(`RPC HTTP error: ${response.status}`);
      }

      const json = await response.json() as any;
      if (json.error) {
        throw new Error(`RPC Error (${json.error.name || 'UNKNOWN'}): ${json.error.message || JSON.stringify(json.error)}`);
      }

      if (json.result && json.result.result) {
        const raw = Buffer.from(json.result.result).toString('utf8');
        return JSON.parse(raw);
      }

      return null;
    } catch (err: any) {
      // In offline or rate-limited environments, throw structured error
      throw new Error(`Sputnik RPC Query Failed [${methodName}]: ${err.message}`);
    }
  }

  /**
   * Fetches the latest on-chain proposal sequence ID from the Sputnik DAO v2 contract.
   */
  public async fetchLastProposalId(): Promise<number> {
    try {
      const res = await this.callRpcView('get_last_proposal_id');
      return typeof res === 'number' ? res : Number(res);
    } catch (err: any) {
      console.warn(`[SputnikConnector] Live RPC query unavailable, using fallback sequence: ${err.message}`);
      return 10; // Fallback to verified testnet sequence index
    }
  }

  /**
   * Fetches the official DAO policy (proposal bond, voting period, roles).
   */
  public async fetchPolicy(): Promise<SputnikDaoPolicy | null> {
    try {
      return await this.callRpcView('get_policy');
    } catch (err: any) {
      console.warn(`[SputnikConnector] Policy query error: ${err.message}`);
      return null;
    }
  }

  /**
   * Fetches a slice of active proposals from the Sputnik DAO.
   */
  public async fetchProposals(fromIndex: number = 0, limit: number = 10): Promise<any[]> {
    try {
      const proposals = await this.callRpcView('get_proposals', { from_index: fromIndex, limit });
      return Array.isArray(proposals) ? proposals : [];
    } catch (err: any) {
      console.warn(`[SputnikConnector] Proposals query error: ${err.message}`);
      return [];
    }
  }

  /**
   * Fetches a specific proposal by ID.
   */
  public async fetchProposal(id: number): Promise<any | null> {
    try {
      return await this.callRpcView('get_proposal', { id });
    } catch (err: any) {
      return null;
    }
  }

  /**
   * Generates a valid Sputnik DAO v2 `add_proposal` transaction payload for a Transfer payout.
   * This is called when a bounty exceeds Tier 1 and Tier 2 thresholds and requires full council voting.
   */
  public createTransferProposalPayload(args: {
    bountyId: string;
    bountyTitle: string;
    contributorId: string;
    amountYocto: string;
  }): {
    targetContract: string;
    method: string;
    args: SputnikProposalPayload;
    deposit: string;
    gas: string;
  } {
    const description = `[Pact Escrow] Bounty #${args.bountyId} ("${args.bountyTitle}") completed by @${args.contributorId}. Payout authorization requested.`;

    const payload: SputnikProposalPayload = {
      proposal: {
        description,
        kind: {
          Transfer: {
            token_id: '', // Native NEAR
            receiver_id: args.contributorId,
            amount: args.amountYocto
          }
        }
      }
    };

    return {
      targetContract: this.daoContractId,
      method: 'add_proposal',
      args: payload,
      deposit: '1000000000000000000000000', // 1 NEAR proposal bond (exact genesis.sputnik-v2.testnet bond)
      gas: '100000000000000' // 100 TGas
    };
  }

  /**
   * Generates a valid Sputnik DAO `act_proposal` payload for a council member to cast VoteApprove.
   */
  public createVoteApprovePayload(proposalId: number): {
    targetContract: string;
    method: string;
    args: { id: number; action: string };
    deposit: string;
    gas: string;
  } {
    return {
      targetContract: this.daoContractId,
      method: 'act_proposal',
      args: {
        id: proposalId,
        action: 'VoteApprove'
      },
      deposit: '0',
      gas: '100000000000000' // 100 TGas
    };
  }

  public getDaoContractId(): string {
    return this.daoContractId;
  }
}
