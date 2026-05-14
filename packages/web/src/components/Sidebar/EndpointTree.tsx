import { useMemo, useState } from 'react';
import type { EndpointConfig } from '../../types.js';

interface EndpointTreeProps {
    endpoints: EndpointConfig[];
    disabledEndpoints: string[];
    onUpdateDisabled: (disabled: string[]) => void;
}

type EndpointLeaf = {
    id: string;
    method: string;
    path: string;
    fieldCount: number;
    fields: { name: string; type: string }[];
};

type TreeNode = {
    name: string;
    children: Record<string, TreeNode>;
    endpoints: EndpointLeaf[];
};

function processPath(path: string): string[] {
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return ['/'];
    const res = [`/${parts[0]}`];
    if (parts.length > 1) res.push(parts[1]);
    if (parts.length > 2) res.push(parts[2]);
    if (parts.length > 3) res.push(parts.slice(3).join('/'));
    return res;
}

function getAllEndpointIds(node: TreeNode): string[] {
    let ids = [...node.endpoints.map((e) => e.id)];
    for (const child of Object.values(node.children)) {
        ids = ids.concat(getAllEndpointIds(child));
    }
    return ids;
}

export function EndpointTree({ endpoints, disabledEndpoints, onUpdateDisabled }: EndpointTreeProps) {
    const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
    const [searchQuery, setSearchQuery] = useState('');
    const [methodFilters, setMethodFilters] = useState<string[]>([]);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

    const toggleExpand = (nodePath: string) => {
        setExpandedNodes((prev) => ({
            ...prev,
            [nodePath]: prev[nodePath] === undefined ? false : !prev[nodePath],
        }));
    };

    const toggleMethod = (method: string) => {
        setMethodFilters(prev =>
            prev.includes(method) ? prev.filter(m => m !== method) : [...prev, method]
        );
    };

    const tree = useMemo(() => {
        const filteredEndpoints = endpoints.filter(ep => {
            if (methodFilters.length > 0 && !methodFilters.includes(ep.method)) return false;
            if (searchQuery && !ep.path.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
        });

        const root: TreeNode = { name: 'root', children: {}, endpoints: [] };
        for (const ep of filteredEndpoints) {
            const segments = processPath(ep.path);
            let current = root;
            for (const seg of segments) {
                if (!current.children[seg]) {
                    current.children[seg] = { name: seg, children: {}, endpoints: [] };
                }
                current = current.children[seg];
            }
            const fields: { name: string; type: string }[] = [];
            if (ep.schema?.properties) {
                for (const [name, prop] of Object.entries(ep.schema.properties)) {
                    let typeStr = prop.type || 'any';
                    if (prop.format) typeStr += ` (${prop.format})`;
                    fields.push({ name, type: typeStr });
                }
            }

            current.endpoints.push({
                id: `${ep.method} ${ep.path}`,
                method: ep.method,
                path: ep.path,
                fieldCount: fields.length,
                fields,
            });
        }
        return root;
    }, [endpoints, searchQuery, methodFilters]);

    const renderNode = (node: TreeNode, currentPath: string, depth: number = 0) => {
        const allIds = getAllEndpointIds(node);
        if (allIds.length === 0 && node.name !== 'root') return null;

        const disabledCount = allIds.filter((id) => disabledEndpoints.includes(id)).length;
        const checked = disabledCount === 0;
        const indeterminate = disabledCount > 0 && disabledCount < allIds.length;

        const toggleNode = () => {
            if (checked || indeterminate) {
                const toDisable = allIds.filter((id) => !disabledEndpoints.includes(id));
                onUpdateDisabled([...disabledEndpoints, ...toDisable]);
            } else {
                const next = disabledEndpoints.filter((id) => !allIds.includes(id));
                onUpdateDisabled(next);
            }
        };

        const hasChildren = Object.keys(node.children).length > 0;
        const isLeaf = !hasChildren && node.name !== 'root';
        const displayName = node.name + (hasChildren && node.name !== '/' ? '/' : '');
        const nodeKey = currentPath ? `${currentPath}/${node.name}` : node.name;
        const isExpanded = expandedNodes[nodeKey] !== false;

        return (
            <div key={nodeKey} className="tree-node" style={{ marginLeft: depth === 0 ? 0 : 12 }}>
                {node.name !== 'root' && !isLeaf && (
                    <div className="tree-node-row">
                        <button className="tree-chevron" onClick={() => toggleExpand(nodeKey)} data-expanded={isExpanded} aria-expanded={isExpanded} aria-label={`Toggle folder ${displayName}`}>
                            ▶
                        </button>
                        <input
                            type="checkbox"
                            className="checkbox"
                            checked={checked}
                            aria-label={`Toggle all endpoints in ${displayName}`}
                            ref={(el) => { if (el) el.indeterminate = indeterminate; }}
                            onChange={toggleNode}
                        />
                        <span className="tree-node-name" onClick={() => toggleExpand(nodeKey)}>
                            {displayName}
                        </span>
                    </div>
                )}

                {(isExpanded || node.name === 'root') && (
                    <div className="tree-children" data-root={node.name === 'root'}>
                        {Object.values(node.children).map((child) => renderNode(child, nodeKey, depth + 1))}

                        {node.endpoints.map((ep) => {
                            const isChecked = !disabledEndpoints.includes(ep.id);
                            return (
                                <div key={ep.id} className="tree-leaf-row">
                                    <input
                                        type="checkbox"
                                        className="checkbox"
                                        checked={isChecked}
                                        aria-label={`Enable endpoint ${ep.id}`}
                                        onChange={() => {
                                            if (isChecked) onUpdateDisabled([...disabledEndpoints, ep.id]);
                                            else onUpdateDisabled(disabledEndpoints.filter((id) => id !== ep.id));
                                        }}
                                    />
                                    <span className={`method method-${ep.method.toLowerCase()}`} style={{ fontSize:9, width:36 }}>
                                        {ep.method}
                                    </span>
                                    <span className="tree-leaf-name">
                                        {isLeaf ? node.name : '/'}
                                    </span>
                                    {ep.fieldCount > 0 && (
                                        <div
                                            style={{ position: 'relative' }}
                                            onMouseEnter={() => setHoveredNodeId(ep.id)}
                                            onMouseLeave={() => setHoveredNodeId(null)}
                                        >
                                            <span className="tree-leaf-meta" style={{ cursor: 'help' }}>{ep.fieldCount} fields</span>
                                            {hoveredNodeId === ep.id && (
                                                <div className="tooltip" style={{ whiteSpace: 'normal', textAlign: 'left', bottom: '100%', right: 0, left: 'auto', transform: 'none', marginBottom: 4, width: 'max-content', maxWidth: 200 }}>
                                                    <div style={{ fontWeight: 600, marginBottom: 4, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 2 }}>Fields</div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                        {ep.fields.map(f => (
                                                            <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                                                <span style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                                                                <span style={{ color: 'var(--text-muted)' }}>{f.type}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    if (endpoints.length === 0) {
        return (
            <div className="empty-state-small">
                Add endpoints manually or load from Swagger
            </div>
        );
    }

    const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ padding: '0 12px' }}>
                <input
                    className="input"
                    placeholder="Search endpoints..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ width: '100%', marginBottom: 6 }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {ALL_METHODS.map(method => (
                        <button
                            key={method}
                            className={`badge ${methodFilters.includes(method) ? 'badge-info' : ''}`}
                            style={{
                                cursor: 'pointer',
                                opacity: methodFilters.length === 0 || methodFilters.includes(method) ? 1 : 0.5,
                                border: methodFilters.includes(method) ? '1px solid var(--color-info)' : '1px solid var(--border-default)',
                                background: methodFilters.includes(method) ? 'rgba(56, 189, 248, 0.1)' : 'transparent',
                                color: methodFilters.includes(method) ? undefined : 'var(--text-primary)'
                            }}
                            onClick={() => toggleMethod(method)}
                        >
                            {method}
                        </button>
                    ))}
                </div>
            </div>
            <div className="endpoint-tree">
                {renderNode(tree, '')}
            </div>
        </div>
    );
}
