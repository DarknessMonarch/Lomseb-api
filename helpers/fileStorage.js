const { minioClient, bucketName } = require('../config/minio');
const crypto = require('crypto');

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;

exports.uploadFile = async (fileBuffer, prefix, fileExtension, metadata = {}) => {
  const filename = `${prefix}_${crypto.randomBytes(8).toString('hex')}.${fileExtension}`;
  const objectPath = `${prefix}/${filename}`;
  
  const contentType = getContentType(fileExtension);
  
  await minioClient.putObject(bucketName, objectPath, fileBuffer, {
    'Content-Type': contentType,
    ...metadata
  });
  
  return `https://${MINIO_ENDPOINT}/${bucketName}/${objectPath}`;
};


exports.deleteFile = async (fileUrl) => {
  if (!fileUrl) return false;
  
  try {
    const objectPath = fileUrl.replace(`https://${MINIO_ENDPOINT}/${bucketName}/`, '');
    await minioClient.removeObject(bucketName, objectPath);
    return true;
  } catch (err) {
    console.error('Error deleting file from MinIO:', err);
    throw err;
  }
};


function getContentType(extension) {
  const types = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    csv: 'text/csv'
  };
  
  return types[extension.toLowerCase()] || 'application/octet-stream';
}
