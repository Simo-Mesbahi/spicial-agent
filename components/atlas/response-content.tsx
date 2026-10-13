import { responseBlocks } from '@/lib/atlas/response-presentation';

export function ResponseContent({ content }: { content: string }) {
  return (
    <div className="response-content">
      {responseBlocks(content).map((block, index) =>
        block.kind === 'text' ? (
          <div className="response-prose" key={index}>
            {block.text}
          </div>
        ) : (
          <div
            className="response-table-wrap"
            key={index}
            role="region"
            tabIndex={0}
            aria-label="Tableau de la réponse"
          >
            <table>
              <thead>
                <tr>
                  {block.headers.map((header, cell) => (
                    <th scope="col" key={cell}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, line) => (
                  <tr key={line}>
                    {row.map((value, cell) => (
                      <td key={cell}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </div>
  );
}
