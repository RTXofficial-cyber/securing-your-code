import React from 'react';

function Node({ node, depth, openPath, onOpen }) {
  if (node.type === 'dir') {
    return (
      <div>
        <div className="tree-node dir" style={{ paddingLeft: 7 + depth * 2 }}>
          <span style={{ opacity: 0.55 }}>▾</span> {node.name}
        </div>
        <div className="tree-children">
          {(node.children || []).map((c) => (
            <Node key={c.path} node={c} depth={depth + 1} openPath={openPath} onOpen={onOpen} />
          ))}
          {(!node.children || node.children.length === 0) && (
            <div className="tree-node" style={{ opacity: 0.4, cursor: 'default' }}>empty</div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`tree-node ${openPath === node.path ? 'active' : ''}`}
      style={{ paddingLeft: 7 + depth * 2 }}
      onClick={() => onOpen(node.path)}
      title={node.path}
    >
      <span style={{ opacity: 0.5 }}>·</span> {node.name}
    </div>
  );
}

export default function FileTree({ tree, openPath, onOpen }) {
  if (!tree || tree.length === 0) {
    return (
      <div className="tree-empty">
        Empty workspace.
        <br />
        Ask the agent to create your first file, or press ＋ above.
      </div>
    );
  }
  return (
    <div>
      {tree.map((n) => (
        <Node key={n.path} node={n} depth={0} openPath={openPath} onOpen={onOpen} />
      ))}
    </div>
  );
}
