import * as core from '@actions/core'
import * as yaml from 'yaml'
import {context} from '@actions/github'
import {
  checkRequiredApprovals,
  Requirement,
  Config,
} from './check-required-approvals'

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

export async function run(): Promise<void> {
  try {
    const config: Config = {
      requirements: parseRequirementsYaml(
        core.getInput('requirements', {
          required: true,
        }),
      ),
      token: core.getInput('github-token', {required: true}),
    }

    const eventName = context.eventName
    if (eventName === 'pull_request') {
      // Always succeed on pull_request events so that we can use this action
      // as a required check for PRs.
      core.setOutput('status', 'success')
    } else if (eventName === 'pull_request_review') {
      await checkRequiredApprovals(config)
    } else {
      core.warning(
        `This action only supports 'pull_request', and 'pull_request_review' events. Received '${eventName}'.`,
      )
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
