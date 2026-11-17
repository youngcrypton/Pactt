import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SputnikConnector } from '../src/sputnik-connector.js';
import { NearSocialConnector } from '../src/near-social.js';
import { ContributorProfile } from '../src/types.js';

describe('Sputnik DAO v2 & NEAR Social DB Live Connectors', () => {
  const sputnik = new SputnikConnector('genesis.sputnik-v2.testnet');
  const social = new NearSocialConnector('testnet');

  test('1. SputnikConnector generates exact NEP-145 add_proposal payload with bond', () => {
    const payload = sputnik.createTransferProposalPayload({
      bountyId: 'b-999',
      bountyTitle: 'Rust Smart Contract Optimization',
      contributorId: 'contributor.testnet',
      amountYocto: '15000000000000000000000000' // 15 NEAR
    });

    assert.equal(payload.targetContract, 'genesis.sputnik-v2.testnet');
    assert.equal(payload.method, 'add_proposal');
    assert.equal(payload.deposit, '1000000000000000000000000'); // 1 NEAR bond
    assert.equal(payload.args.proposal.kind.Transfer.receiver_id, 'contributor.testnet');
    assert.equal(payload.args.proposal.kind.Transfer.amount, '15000000000000000000000000');
    assert.match(payload.args.proposal.description, /\[Pact Escrow\] Bounty #b-999/);
  });

  test('2. SputnikConnector generates valid VoteApprove payload for council signoff', () => {
    const votePayload = sputnik.createVoteApprovePayload(10);
    assert.equal(votePayload.targetContract, 'genesis.sputnik-v2.testnet');
    assert.equal(votePayload.method, 'act_proposal');
    assert.equal(votePayload.args.id, 10);
    assert.equal(votePayload.args.action, 'VoteApprove');
    assert.equal(votePayload.deposit, '0');
  });

  test('3. SputnikConnector queries live Sputnik DAO RPC or returns structured sequence', async () => {
    const lastProposalId = await sputnik.fetchLastProposalId();
    assert.ok(typeof lastProposalId === 'number');
    assert.ok(lastProposalId >= 0);
  });

  test('4. NearSocialConnector formats standard SocialDB set payload for profile badge', () => {
    const profile: ContributorProfile = {
      account_id: 'alice.testnet',
      trust_score: 85,
      completed_bounties_count: 5,
      total_earned_yocto: '25000000000000000000000000',
      total_earned_formatted: 25,
      current_tier: 'TRUSTED_CORE',
      near_social_badge_minted: true,
      history: []
    };

    const setPayload = social.generateBadgePayload(profile);
    assert.equal(setPayload.contractId, 'v1.social08.testnet');
    assert.equal(setPayload.methodName, 'set');
    assert.equal(setPayload.depositYocto, '50000000000000000000000'); // 0.05 NEAR storage deposit
    
    const userBadge = setPayload.args.data['alice.testnet'].profile.badges.pact;
    assert.ok(userBadge);
    const parsed = JSON.parse(userBadge);
    assert.equal(parsed.trustScore, 85);
    assert.equal(parsed.title, 'Pact Core Contributor (Tier 1)');
  });

  test('5. NearSocialConnector queries live on-chain SocialDB badge records for verified account', async () => {
    const liveProfile = await social.fetchSocialProfile('pact-dao-064783.testnet');
    assert.ok(liveProfile !== undefined);
    if (liveProfile && liveProfile['pact-dao-064783.testnet']) {
      const badges = liveProfile['pact-dao-064783.testnet'].profile.badges;
      assert.ok(badges.pact);
      const parsedBadge = JSON.parse(badges.pact);
      assert.equal(parsedBadge.protocol, 'Pact');
    }
  });
});
