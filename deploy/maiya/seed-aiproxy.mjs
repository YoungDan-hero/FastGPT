const channels = [
  {
    name: '阿里百炼',
    type: 17,
    key: process.env.DASHSCOPE_API_KEY,
    base_url: 'https://dashscope.aliyuncs.com',
    models: [
      'qwen-plus',
      'qwen4-max',
      'qwen3.8-flash',
      'text-embedding-v4',
      'qwen3.7-text-embedding',
      'qwen3.7-text-embedding-flash'
    ]
  },
  {
    name: '火山方舟',
    type: 40,
    key: process.env.ARK_API_KEY,
    base_url: 'https://ark.cn-beijing.volces.com',
    models: [
      'doubao-seed-2-1-pro-260915',
      'deepseek-v4-1-flash-261017',
      'doubao-embedding-vision-251215'
    ]
  }
];

async function request(path, payload) {
  const response = await fetch(`http://aiproxy:3000/api/${path}`, {
    method: payload ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${process.env.AIPROXY_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    ...(payload && { body: JSON.stringify(payload) }),
    redirect: 'error',
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`AI Proxy request failed (HTTP ${response.status})`);
  const result = await response.json();
  if (result.success === false) throw new Error('AI Proxy rejected the channel request');
  return result.data;
}

for (const channel of channels) {
  const params = new URLSearchParams({ keyword: channel.name, page: '1', per_page: '100' });
  const data = await request(`channels/search?${params}`);
  if (data?.channels?.some(({ name }) => name === channel.name)) continue;
  await request('channel/', { ...channel, status: 1 });
  console.log(`Added AI Proxy channel ${channel.name}`);
}
