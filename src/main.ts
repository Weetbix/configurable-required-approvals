import * as core from '@actions/core'
import * as yaml from 'yaml'
import {context, getOctokit} from '@actions/github'
import {minimatch} from 'minimatch'

type Octokit = ReturnType<typeof getOctokit>

interface Requirement {
  patterns: string[]
  requiredApprovals: number
}

interface Config {
  requirements: Requirement[]
  token: string
}

async function getPRFilenames(octokit: Octokit): Promise<string[]> {
  const {data: files} = await octokit.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request?.number ?? 0,
  })

  return files.map(file => file.filename)
}

function hasChangedFilesMatchingPatterns(
  patterns: string[],
  filenames: string[],
): boolean {
  return patterns.some(
    pattern => minimatch.match(filenames, pattern).length > 0,
  )
}

const parseRequirementsYaml = (requirements: string): Requirement[] => {
  const parsed = yaml.parse(requirements)
  if (!Array.isArray(parsed)) {
    throw new Error('Requirements must be an array')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return parsed.map((requirement: any) => {
    if (typeof requirement !== 'object') {
      throw new Error('Requirement must be an object')
    }

    if (!Array.isArray(requirement.patterns)) {
      throw new Error('Requirement must have a patterns array')
    }

    if (typeof requirement.requiredApprovals !== 'number') {
      throw new Error('Requirement must have a requiredApprovals number')
    }

    return {
      patterns: requirement.patterns,
      requiredApprovals: requirement.requiredApprovals,
    }
  })
}

async function run(): Promise<void> {
  try {
    const config: Config = {
      requirements: parseRequirementsYaml(
        core.getInput('requirements', {
          required: true,
        }),
      ),
      token: core.getInput('github-token', {required: true}),
    }

    let actionFailed = false
    const octokit = getOctokit(config.token)
    const filenames = await getPRFilenames(octokit)

    for (const requirement of config.requirements) {
      const hasChanges = hasChangedFilesMatchingPatterns(
        requirement.patterns,
        filenames,
      )

      if (hasChanges) {
        const {data: reviews} = await octokit.rest.pulls.listReviews({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: context.payload.pull_request?.number ?? 0,
        })

        const approvals = reviews.filter(
          review => review.state === 'APPROVED',
        ).length

        if (approvals < requirement.requiredApprovals) {
          actionFailed = true
          core.info(
            `Required approvals not met for files matching patterns: ${requirement.patterns.join(
              ', ',
            )}`,
          )
        }
      }
    }

    if (actionFailed) {
      core.setFailed(`Required approvals not met for one or more patterns`)
    } else {
      core.info('All checks passed!')
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Action failed with error: ${error.message}`)
    } else {
      core.setFailed(`Action failed.`)
    }
  }
}

run()
