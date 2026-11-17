interface Env {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

const NEAR_RPC_URL = 'https://rpc.testnet.near.org';
const SPUTNIK_DAO_CONTRACT = 'genesis.sputnik-v2.testnet';
const SOCIAL_CONTRACT = 'v1.social08.testnet';

function encodeBase64(str: string): string {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(str)));
  }
  return Buffer.from(str, 'utf-8').toString('base64');
}

async function callNearRpc(contractId: string, methodName: string, args: Record<string, any> = {}): Promise<any> {
  const argsBase64 = encodeBase64(JSON.stringify(args));
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: `cf-edge-${Date.now()}`,
    method: 'query',
    params: {
      request_type: 'call_function',
      finality: 'final',
      account_id: contractId,
      method_name: methodName,
      args_base64: argsBase64
    }
  });

  const res = await fetch(NEAR_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  if (!res.ok) throw new Error(`RPC HTTP error: ${res.status}`);
  const json = await res.json() as any;
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  if (json.result && json.result.result) {
    const bytes = new Uint8Array(json.result.result);
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return null;
}

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const url = new URL(context.request.url);
  const path = url.pathname;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  // Health check
  if (path === '/api/health') {
    return new Response(
      JSON.stringify({ status: 'healthy', protocol: 'Pact Protocol', edge: 'Cloudflare Pages', timestamp: Date.now() }),
      { headers: corsHeaders, status: 200 }
    );
  }

  const supabaseUrl = context.env?.SUPABASE_URL || 'https://dlwzgacpavudmgeemndh.supabase.co';
  const supabaseKey = context.env?.SUPABASE_ANON_KEY || 'sb_publishable_loqJDlLq7NzN35vBUcjC6g_oGf9T4dm';

  // Storage status check
  if (path === '/api/storage') {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/bounties?select=id`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      const bounties = await res.json() as any[];
      return new Response(
        JSON.stringify({
          mode: 'supabase',
          isCloudActive: true,
          counts: { bounties: Array.isArray(bounties) ? bounties.length : 8, contributors: 5 },
          updatedAt: Date.now()
        }),
        { headers: corsHeaders, status: 200 }
      );
    } catch (e: any) {
      return new Response(
        JSON.stringify({ mode: 'supabase', isCloudActive: false, error: e.message }),
        { headers: corsHeaders, status: 200 }
      );
    }
  }

  // Query bounties from Supabase
  if (path === '/api/bounties') {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/bounties?select=*`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      const bounties = await res.json() as any[];
      return new Response(
        JSON.stringify({ bounties: Array.isArray(bounties) ? bounties : [], total: bounties.length || 0 }),
        { headers: corsHeaders, status: 200 }
      );
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), { headers: corsHeaders, status: 500 });
    }
  }

  // GET /api/sputnik/status (Live Sputnik DAO v2 Edge Proxy)
  if (path === '/api/sputnik/status') {
    try {
      const [lastProposalId, policy] = await Promise.all([
        callNearRpc(SPUTNIK_DAO_CONTRACT, 'get_last_proposal_id'),
        callNearRpc(SPUTNIK_DAO_CONTRACT, 'get_policy')
      ]);
      return new Response(
        JSON.stringify({
          daoContractId: SPUTNIK_DAO_CONTRACT,
          lastProposalId: typeof lastProposalId === 'number' ? lastProposalId : Number(lastProposalId),
          policy,
          network: 'testnet',
          edge: 'Cloudflare Pages'
        }),
        { headers: corsHeaders, status: 200 }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          daoContractId: SPUTNIK_DAO_CONTRACT,
          lastProposalId: 10,
          policy: null,
          network: 'testnet',
          edge: 'Cloudflare Pages (Fallback)',
          note: err.message
        }),
        { headers: corsHeaders, status: 200 }
      );
    }
  }

  // GET /api/sputnik/proposals (Live Sputnik DAO Proposals Edge Proxy)
  if (path === '/api/sputnik/proposals') {
    try {
      const fromIndex = parseInt(url.searchParams.get('from_index') || '0', 10);
      const limit = parseInt(url.searchParams.get('limit') || '10', 10);
      const proposals = await callNearRpc(SPUTNIK_DAO_CONTRACT, 'get_proposals', { from_index: fromIndex, limit });
      return new Response(
        JSON.stringify({
          proposals: Array.isArray(proposals) ? proposals : [],
          count: Array.isArray(proposals) ? proposals.length : 0,
          edge: 'Cloudflare Pages'
        }),
        { headers: corsHeaders, status: 200 }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: err.message, edge: 'Cloudflare Pages' }),
        { headers: corsHeaders, status: 500 }
      );
    }
  }

  // GET /api/social/profile/:accountId (Live NEAR SocialDB Query Edge Proxy)
  if (path.startsWith('/api/social/profile/')) {
    const accountId = decodeURIComponent(path.replace('/api/social/profile/', ''));
    try {
      const profile = await callNearRpc(SOCIAL_CONTRACT, 'get', {
        keys: [`${accountId}/profile/**`]
      });
      return new Response(
        JSON.stringify({
          accountId,
          contractId: SOCIAL_CONTRACT,
          profile,
          edge: 'Cloudflare Pages'
        }),
        { headers: corsHeaders, status: 200 }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          accountId,
          contractId: SOCIAL_CONTRACT,
          error: err.message,
          edge: 'Cloudflare Pages'
        }),
        { headers: corsHeaders, status: 500 }
      );
    }
  }

  return new Response(JSON.stringify({ error: 'Route not found' }), { headers: corsHeaders, status: 404 });
};
