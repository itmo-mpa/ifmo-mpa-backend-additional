import ActiveSubstanceInMedicine from '@alexstrive/ifmo-mpa-orm/models/ActiveSubstanceInMedicine'
import * as fastify from 'fastify'

import { Op } from 'sequelize'

import Patient from '@alexstrive/ifmo-mpa-orm/models/Patient'
import DiseaseCase from '@alexstrive/ifmo-mpa-orm/models/DiseaseCase'
import Disease from '@alexstrive/ifmo-mpa-orm/models/Disease'
import Medicine from '@alexstrive/ifmo-mpa-orm/models/Medicine'
import PatientContradictions from '@alexstrive/ifmo-mpa-orm/models/PatientContradictions'
import Substance from '@alexstrive/ifmo-mpa-orm/models/Substance'
import Status from '@alexstrive/ifmo-mpa-orm/models/Status'
import DiseaseContradictions from '@alexstrive/ifmo-mpa-orm/models/DiseaseContradictions'
import SubstanceContradictions from '@alexstrive/ifmo-mpa-orm/models/SubstanceContradictions'

export default async (fastify: fastify.FastifyInstance, routeOptions) => {
  const getContradictionsOptions: fastify.RouteShorthandOptions = {
    schema: {
      querystring: {
        type: 'object',
        required: ['patientId'],
        properties: {
          patientId: { type: 'number' }
        }
      }
    }
  }

  fastify.get(
    '/contradictions',
    getContradictionsOptions,
    async (request, reply) => {
      const { patientId } = request.query

      const patient = await Patient.findByPk(patientId, {
        include: [
          {
            model: PatientContradictions,
            as: 'contradictions',
            include: [Substance]
          }
        ]
      })

      const result = patient.contradictions.reduce(
        (others, contradiction) => [
          ...others,
          {
            reason: {
              type: contradiction.reasonType,
              id: contradiction.reasonId
            },
            substance: { id: contradiction.substance?.id },
            level: contradiction.level
          }
        ],
        []
      )

      return result
    }
  )

  const putContradictionsOptions: fastify.RouteShorthandOptions = {
    schema: {
      body: {
        type: 'object',
        required: ['patientId', 'reasonType', 'reasonId', 'substanceId'],
        properties: {
          patientId: { type: 'number' },
          reasonType: {
            type: 'string',
            enum: ['SUBSTANCE', 'DISEASE', 'OTHER']
          },
          reasonId: { type: 'number' },
          substanceId: { type: 'number' },
          level: { type: 'string', enum: ['LIGHT', 'AVERAGE', 'HIGH'] }
        }
      }
    }
  }

  fastify.put(
    '/contradictions',
    putContradictionsOptions,
    async (request, reply) => {
      const {
        patientId,
        reasonId,
        reasonType,
        substanceId,
        level
      } = request.body

      let patient

      try {
        patient = await Patient.findByPk(patientId, {
          rejectOnEmpty: true
        })
      } catch (e) {
        throw new Error(
          `Patient with provided "patientId": ${patientId} not found`
        )
      }

      let substance

      try {
        substance = await Substance.findByPk(substanceId, {
          rejectOnEmpty: true
        })
      } catch (e) {
        throw new Error(
          `Substance with provided "substanceId": ${substanceId} not found`
        )
      }

      const contradiction = PatientContradictions.create({
        patientId: patient.id,
        substanceId: substance.id,
        reasonId,
        reasonType,
        level
      })

      return contradiction
    }
  )

  const deleteContradictionsOptions: fastify.RouteShorthandOptions = {
    schema: {
      body: {
        type: 'object',
        required: ['recordId'],
        properties: {
          recordId: { type: 'number' }
        }
      }
    }
  }

  fastify.delete(
    '/contradictions',
    deleteContradictionsOptions,
    async (request, reply) => {
      return {}
    }
  )

  const postContradictionsOptions: fastify.RouteShorthandOptions = {
    schema: {
      body: {
        type: 'object',
        required: ['patientId'],
        properties: {
          patientId: { type: 'number' }
        }
      }
    }
  }

  const contradictionStates = {
    LIGHT: 0,
    AVERAGE: 1,
    HIGH: 2
  }

  const generateDiseaseContradictions = async (patient) => {
    const diseaseContradictionsByStates = await Promise.all(
      patient.anamnesis.map((diseaseCase) =>
        DiseaseContradictions.findAll({
          where: {
            diseaseId: diseaseCase.diseaseId,
            state: diseaseCase.state
          },
          raw: true
        })
      )
    )

    const flattenDiseaseContradictionsByStates: any = diseaseContradictionsByStates.reduce(
      (acc: any, current) => acc.concat(current),
      []
    )

    const result: any = flattenDiseaseContradictionsByStates.reduce(
      (acc: any, contradiction: any, id, src) => {
        if (
          src.findIndex(
            (item: any) =>
              item.diseaseId === contradiction.diseaseId &&
              contradictionStates[item.level] >
                contradictionStates[contradiction.level]
          ) !== -1
        ) {
          return acc
        }

        return [...acc, contradiction]
      },
      []
    )

    return result.map((contradiction) => ({
      reasonType: 'DISEASE',
      reasonId: contradiction.diseaseId,
      patientId: Number.parseInt(patient.id),
      substanceId: contradiction.withSubstanceId,
      level: contradiction.level
    }))
  }

  const generateSubstanceContradictions = async (patient) => {
    const substanceIds = patient.status.medicines
      .map((medicine) => medicine.substances)
      .map((substances) =>
        substances.map((substance) => substance.active_substance_id)
      )
      .flat()

    const uniqueSubstanceIds = [...new Set(substanceIds)]

    console.log(uniqueSubstanceIds)

    const substanceContradictions = await Promise.all(
      uniqueSubstanceIds.map((substanceId) =>
        SubstanceContradictions.findAll({ where: { substanceId } })
      )
    )

    // Polyfill for .flat
    // Due inability to use this method
    const result = substanceContradictions.reduce(
      (acc, current) => acc.concat(current),
      []
    )

    return result.map((contradiction) => ({
      reasonType: 'SUBSTANCE',
      reasonId: contradiction.substanceId,
      patientId: Number.parseInt(patient.id),
      substanceId: contradiction.withSubstanceId,
      level: contradiction.level
    }))
  }

  fastify.post(
    '/contradictions',
    postContradictionsOptions,
    async (request, reply) => {
      const { patientId } = request.body

      const patient = await Patient.findByPk(patientId, {
        include: [
          { model: DiseaseCase, as: 'anamnesis' },
          {
            model: Status,
            as: 'status',
            include: [
              {
                model: Medicine,
                include: [
                  { model: ActiveSubstanceInMedicine, include: [Substance] }
                ]
              }
            ]
          },
          { model: PatientContradictions, as: 'contradictions' }
        ]
      })

      try {
        await PatientContradictions.bulkCreate(
          [
            ...(await generateDiseaseContradictions(patient)),
            ...(await generateSubstanceContradictions(patient))
          ],
          {
            updateOnDuplicate: ['level']
          }
        )
      } catch (e) {
        console.log(e)
      }

      await patient.reload()

      return patient.contradictions
    }
  )
}
