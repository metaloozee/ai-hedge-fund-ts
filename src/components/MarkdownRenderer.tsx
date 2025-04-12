import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(({ content }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ node, ...props }) => <p className="text-sm text-muted-foreground leading-relaxed mb-4" {...props} />,
        h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mt-6 mb-3 pb-1 border-b border-border" {...props} />,
        h2: ({ node, ...props }) => <h2 className="text-xl font-semibold mt-5 mb-2 pb-1 border-b border-border" {...props} />,
        h3: ({ node, ...props }) => <h3 className="text-lg font-semibold mt-4 mb-2" {...props} />,
        ul: ({ node, ...props }) => <ul className="list-disc list-outside pl-6 mb-4 space-y-1 text-sm text-muted-foreground" {...props} />,
        ol: ({ node, ...props }) => <ol className="list-decimal list-outside pl-6 mb-4 space-y-1 text-sm text-muted-foreground" {...props} />,
        li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
        a: ({ node, ...props }) => <a className="text-primary hover:underline font-medium" target="_blank" rel="noopener noreferrer" {...props} />,
        blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-muted pl-4 italic text-muted-foreground my-5" {...props} />,
        code: ({ node, ...props }) => <code className="bg-muted px-1.5 py-1 rounded text-sm font-mono text-muted-foreground" {...props} />,
        strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
        em: ({ node, ...props }) => <em className="italic" {...props} />,
        hr: ({ node, ...props }) => <hr className="my-6 border-border" {...props} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer; 