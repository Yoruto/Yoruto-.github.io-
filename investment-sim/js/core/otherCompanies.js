/**
 * otherCompanies - v0.5.0 基础数据加载与查询 API
 * 提供：加载数据、按类别过滤、按 id 查询、简单搜索
 */

let _cache = null;

async function loadData() {
  if (_cache) return _cache;
  const tryPaths = [
    '../../../data/investment-sim/other-companies.json',
    '/data/investment-sim/other-companies.json',
  ];
  let lastError = null;
  for (const path of tryPaths) {
    try {
      const res = await fetch(path);
      if (res.ok) {
        _cache = await res.json();
        return _cache;
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error('无法加载 other-companies 数据: ' + (lastError?.message || 'all paths failed'));
}

export async function loadOtherCompanies() {
  return await loadData();
}

export async function getCategories() {
  const d = await loadData();
  return d.categories || [];
}

export async function getCompaniesByCategory(categoryId) {
  const d = await loadData();
  return (d.companies || []).filter((c) => c.category === categoryId);
}

export async function getCompanyById(id) {
  const d = await loadData();
  return (d.companies || []).find((c) => c.id === id) || null;
}

export async function searchCompanies(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  const d = await loadData();
  return (d.companies || []).filter((c) => {
    return (
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.shortName && c.shortName.toLowerCase().includes(q)) ||
      (c.description && c.description.toLowerCase().includes(q))
    );
  });
}

export function clearCache() {
  _cache = null;
}
