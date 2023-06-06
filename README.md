# Configurable Required Approvals GitHub Action

This GitHub Action checks if specific files in a pull request have the required number of approvals.
It allows you to define groups of files using glob patterns and specify the minimum number of approvals required for each group.

## Why

GitHub only lets you set the required number of approvals on a global level. In a monorepo, we may have sensitive projects which
require more than 1 reviewer, and we dont want to force multiple approvals on all of the monorepo.

With this action, you can set paths and approval requirements based on file change globs, and then make this check required.

## Usage

Here's an example workflow configuration:

```yaml
name: Required Approvals

on:
  pull_request:
  pull_request_review:

jobs:
  required-approvals:
    runs-on: ubuntu-latest

    steps:
      - name: Check required approvals
        uses: weetbix/configurable-required-approvals@v1
        with:
          requirements: |
            - patterns:
                - "frontend/packages/kinda-sensitive/**/*"
                - "frontend/packages/kinda-sensitive-2/**/*"
              requiredApprovals: 2
            - patterns:
                - "very-sensitive/**/*"
              requiredApprovals: 3
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

You would then make `required-approvals` a required check in the repository's branch protection.

## Inputs

- `requirements`: A YAML-formatted list of requirements. Each requirement consists of `patterns` (an array of glob patterns) and `requiredApprovals` (the minimum number of approvals required). Example:

  ```yaml
  requirements: |
    - patterns:
        - "frontend/packages/cool-app/**/*"
      requiredApprovals: 2
    - patterns:
        - "backend/**/*"
        - "shared/**/*"
      requiredApprovals: 3
  ```

- `github-token` (required): The GitHub token used to authenticate API requests. You can use the `${{ secrets.GITHUB_TOKEN }}` secret token provided by GitHub.

## Behavior

- If none of the files in the specified patterns are touched in the pull request, the action passes.
- If files in the specified patterns are touched, the action checks if the pull request has the required number of approvals.
- If the required number of approvals is not met, the action fails.
