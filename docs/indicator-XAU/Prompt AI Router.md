Implement the AI Router only after the deterministic market-analysis engine is working.

Requirements:

1. Create a provider-independent interface.
2. Providers must be pluggable.
3. Never couple business logic to a single AI vendor.
4. Support configurable:
   - provider
   - model
   - API key
   - timeout
   - retry
   - token limit
   - temperature if supported
5. Implement structured JSON input/output.
6. Validate AI responses against schemas.
7. Reject malformed responses.
8. Never allow AI output to directly execute trades.
9. Record:
   - provider
   - model
   - request
   - response
   - latency
   - token usage if available
   - error
10. If a provider fails, the system must degrade gracefully.
11. Never fabricate an AI response.
12. Never fabricate missing market data.

Implement these logical roles:

- Macro Analyst
- Intraday Analyst
- Entry Analyst
- Contrarian/Risk Analyst
- Consensus Engine

The Risk Engine remains the final authority.

Write tests using mocked AI providers.

Do not connect real trading execution.