# Pre-Commit Hooks Plan: Detecting AI Reward Hacking

## Executive Summary

This document outlines a comprehensive pre-commit hook system designed to detect and prevent "reward hacking" behaviors in AI-generated code, particularly focusing on test quality, code integrity, and adherence to project standards. The hooks will catch attempts to bypass quality checks through various anti-patterns.

## Identified Reward Hacking Patterns

### 1. Test Manipulation
- **Skip Patterns**: Using `.skip()`, `.only()`, `.todo()`, `xit()`, `xdescribe()`, `fit()`, `fdescribe()`
- **Commented Tests**: Commenting out entire test blocks to avoid failures
- **Empty Tests**: Tests with no assertions or meaningful checks
- **Tautological Tests**: Tests that always pass (e.g., `expect(true).toBe(true)`)
- **Mock-Only Tests**: Testing the mock's return value instead of actual behavior
- **Silent Failures**: Empty try-catch blocks that suppress errors

### 2. Linter/Type Checker Bypasses
- **ESLint Disables**: `eslint-disable`, `eslint-disable-next-line` without justification
- **TypeScript Ignores**: `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`
- **Prettier Ignores**: `prettier-ignore` comments
- **Any Type Usage**: Using `any` type to bypass TypeScript checks
- **Assertion Bypasses**: `as any`, `as unknown as Type` patterns

### 3. Test Quality Violations (from TESTING.md)
- **Low Assertion Density**: Less than 2 assertions per test
- **Excessive Mocking**: More than 3 mocks per test file
- **Implementation Testing**: Testing internal methods rather than behavior
- **Snapshot Overuse**: Using snapshots as the only assertion
- **Magic Numbers**: Unexplained numeric literals in tests

### 4. Code Quality Anti-Patterns
- **Console Statements**: Left-in `console.log()`, `console.error()` in production code
- **Debugger Statements**: Forgotten `debugger` statements
- **TODO Comments**: Unaddressed `TODO`, `FIXME`, `HACK` comments
- **Large Commits**: Attempting to bypass review with massive changes
- **Binary Files**: Unexplained binary file additions

## Proposed Pre-Commit Hook Architecture

### Hook Structure
```
.husky/
├── pre-commit              # Main orchestrator
├── _/
│   ├── husky.sh           # Husky bootstrapper
│   └── ...
scripts/
├── pre-commit-checks/
│   ├── test-skip-detector.ts
│   ├── linter-bypass-detector.ts
│   ├── test-quality-validator.ts
│   ├── code-smell-detector.ts
│   ├── ai-pattern-detector.ts
│   └── orchestrator.ts
```

### Implementation Phases

#### Phase 1: Core Detection (Week 1)
1. **Test Skip Detector**
   - Scan for skip patterns in test files
   - Detect commented test blocks
   - Flag tests without assertions
   - Identify tautological tests

2. **Linter Bypass Detector**
   - Find eslint-disable comments
   - Detect TypeScript ignore annotations
   - Check for `any` type usage
   - Validate disable comments have justification

#### Phase 2: Quality Enforcement (Week 2)
3. **Test Quality Validator**
   - Assertion density checker (min 2 per test)
   - Mock limit enforcer (max 3 per file)
   - Empty catch block detector
   - Mock-only test identifier

4. **Code Smell Detector**
   - Console statement finder
   - Debugger statement scanner
   - TODO/FIXME counter with age tracking
   - Magic number detector in tests

#### Phase 3: Advanced Detection (Week 3)
5. **AI Pattern Detector**
   - Suspicious comment patterns (e.g., "Working correctly" without evidence)
   - Repetitive test names indicating generation
   - Unusually perfect code formatting (potential copy-paste)
   - Tests that don't actually test the described behavior

### Detection Algorithms

#### 1. Sophisticated Skip Detection
```typescript
// Detect various skip patterns including Unicode variations
const skipPatterns = [
  /\.skip\s*\(/,
  /\.only\s*\(/,
  /\bxit\s*\(/,
  /\bxdescribe\s*\(/,
  /\bfit\s*\(/,
  /\bfdescribe\s*\(/,
  // Detect commented test blocks
  /\/\*[\s\S]*?(?:it|test|describe)\s*\([^)]*\)[\s\S]*?\*\//,
  /\/\/\s*(?:it|test|describe)\s*\([^)]*\)/,
];
```

#### 2. Tautological Test Detection
```typescript
// Detect tests that always pass
const tautologyPatterns = [
  /expect\s*\(\s*true\s*\)\s*\.toBe\s*\(\s*true\s*\)/,
  /expect\s*\(\s*false\s*\)\s*\.toBe\s*\(\s*false\s*\)/,
  /expect\s*\(\s*(\w+)\s*\)\s*\.toBe\s*\(\s*\1\s*\)/, // Same variable
  /expect\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.toBe\s*\(\s*['"`]\1['"`]\s*\)/, // Same string
];
```

#### 3. Mock-Only Test Detection
```typescript
// Detect tests that only verify mock return values
function isMockOnlyTest(testBody: string): boolean {
  const hasMockSetup = /mock(?:Resolved|Rejected|Return)Value/.test(testBody);
  const hasRealFunctionCall = /await\s+\w+\(|const\s+result\s*=/.test(testBody);
  const onlyTestsMockReturn = /expect\s*\(\s*result\s*\)\s*\.toEqual\s*\(\s*mock\w+\s*\)/.test(testBody);
  
  return hasMockSetup && !hasRealFunctionCall && onlyTestsMockReturn;
}
```

#### 4. AI-Generated Pattern Detection
```typescript
// Detect suspiciously perfect or repetitive patterns
function detectAIPatterns(content: string): string[] {
  const issues = [];
  
  // Repetitive test descriptions
  const testNames = content.match(/(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g) || [];
  const nameFrequency = countFrequency(testNames);
  if (hasSuspiciousRepetition(nameFrequency)) {
    issues.push('Repetitive test names detected');
  }
  
  // Generic comments
  const genericComments = content.match(/\/\/\s*(Working correctly|Fixed|Updated|Changed)/gi) || [];
  if (genericComments.length > 2) {
    issues.push('Generic comments without context');
  }
  
  return issues;
}
```

### Error Reporting

Each violation will have:
1. **Clear Error Message**: What was detected and why it's problematic
2. **File Location**: Exact file and line number
3. **Suggestion**: How to fix the issue properly
4. **Override Option**: How to bypass if truly necessary (with justification)

Example output:
```
❌ Pre-commit checks failed:

TEST QUALITY VIOLATIONS:
  src/__tests__/user-service.test.ts:45
    ⚠️  Low assertion density: 1 assertion (minimum: 2)
    Test: "should create user"
    💡 Add meaningful assertions to verify the behavior

LINTER BYPASSES:
  src/services/auth.ts:23
    ⚠️  ESLint disable without justification
    Found: "// eslint-disable-next-line @typescript-eslint/no-explicit-any"
    💡 Add justification: "// eslint-disable-next-line @typescript-eslint/no-explicit-any -- External API type"

AI PATTERN DETECTED:
  src/__tests__/payment.test.ts
    ⚠️  Possible mock-only test detected
    Test only verifies mock return value without testing actual behavior
    💡 Test the actual function behavior, not just the mock

To commit anyway (not recommended):
  git commit --no-verify -m "your message"

To add justified overrides:
  Add "// @reward-hack-check-disable: <reason>" before the violation
```

### Configuration

`.reward-hack-check.json`:
```json
{
  "rules": {
    "test-skip": "error",
    "linter-bypass": "error",
    "assertion-density": {
      "severity": "error",
      "minimum": 2
    },
    "mock-limit": {
      "severity": "error",
      "maximum": 3
    },
    "console-statements": "warning",
    "todo-comments": {
      "severity": "warning",
      "maxAge": "30d"
    }
  },
  "ignore": [
    "**/*.config.js",
    "**/scripts/**",
    "**/build/**"
  ],
  "overrides": {
    "src/legacy/**": {
      "assertion-density": "warning"
    }
  }
}
```

### Integration with Existing Tools

1. **Husky**: Use for git hook management
2. **lint-staged**: Run checks only on staged files
3. **Jest**: Integrate with test runner for additional validation
4. **ESLint**: Create custom rules for pattern detection
5. **GitHub Actions**: Run same checks in CI/CD

### Performance Considerations

- **Incremental Checking**: Only check changed files
- **Parallel Processing**: Run different checks concurrently
- **Caching**: Cache AST parsing results
- **Early Exit**: Stop on first error in fast mode
- **Timeout Protection**: Prevent hanging on large files

### Bypass Mechanisms (With Audit Trail)

For legitimate cases where bypassing is necessary:

1. **Inline Justification**:
   ```typescript
   // @reward-hack-check-disable test-skip: Testing skip functionality itself
   it.skip('should skip this test', () => {
     // ...
   });
   ```

2. **File-Level Exemption**:
   ```typescript
   /* @reward-hack-check-disable-file: Legacy code pending refactor - JIRA-1234 */
   ```

3. **Temporary Override** (with expiration):
   ```typescript
   // @reward-hack-check-disable-until: 2024-03-01 - Waiting for API fix
   ```

### Metrics and Reporting

Track and report on:
- Violation frequency by type
- Most common violations
- Developer-specific patterns
- Bypass usage and justifications
- Trends over time

### Rollout Strategy

1. **Week 1**: Deploy in warning mode
2. **Week 2**: Enable blocking for critical violations
3. **Week 3**: Full enforcement with documented bypass process
4. **Month 2**: Review metrics and adjust thresholds

### Future Enhancements

1. **Machine Learning Integration**: Train model on known reward hacking patterns
2. **Context-Aware Analysis**: Use AST for deeper code understanding
3. **Cross-File Analysis**: Detect patterns across multiple files
4. **Integration with Code Review**: Automatic PR comments
5. **Developer Education**: Suggest learning resources for violations

## Conclusion

This comprehensive pre-commit hook system will significantly reduce the ability for AI systems to "game" the development process through various anti-patterns. By focusing on behavior rather than just syntax, and by requiring justification for bypasses, we maintain code quality while allowing flexibility for legitimate edge cases.

The key to success will be:
1. Clear communication about why these checks exist
2. Good error messages with actionable fixes
3. Reasonable bypass mechanisms with accountability
4. Continuous improvement based on metrics
5. Balance between strictness and developer productivity